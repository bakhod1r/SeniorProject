# Observability

> Senior-level Go backend interview questions on observability: metrics, logs, traces, Prometheus/OpenTelemetry internals, RED/USE methods, percentiles, SLOs and burn-rate alerting, and debugging production tail latency.

**27 questions** across **10 topics** · Level: senior

## Topics

- [Three Pillars & Observability vs Monitoring](#three-pillars-observability-vs-monitoring) (2)
- [Metrics & Prometheus Model](#metrics-prometheus-model) (4)
- [RED, USE & Golden Signals](#red-use-golden-signals) (2)
- [Histograms, Percentiles & PromQL](#histograms-percentiles-promql) (3)
- [Distributed Tracing & OpenTelemetry](#distributed-tracing-opentelemetry) (4)
- [Correlation: Logs, Traces & Exemplars](#correlation-logs-traces-exemplars) (1)
- [Structured Logging in Go (slog)](#structured-logging-in-go-slog) (2)
- [Alerting: SLI/SLO & Burn-Rate](#alerting-slislo-burn-rate) (4)
- [Dashboards, Cardinality & Cost at Scale](#dashboards-cardinality-cost-at-scale) (2)
- [Debugging Production & OTel Vendor-Neutrality](#debugging-production-otel-vendor-neutrality) (3)

---

## Three Pillars & Observability vs Monitoring

#### 1. What are the three pillars of observability, and what specific question does each one answer?

*Difficulty:* 🟢 warm-up  ·  *Tags:* `pillars`, `fundamentals`, `metrics`, `logs`, `traces`

The three pillars are **metrics**, **logs**, and **traces**. **Metrics** answer *"is something wrong, and how much?"* — they are cheap, aggregatable numeric time series (request rate, error count, latency histograms) good for dashboards and alerting. **Logs** answer *"what exactly happened in this one event?"* — discrete, high-cardinality records with rich context, good for forensic detail. **Traces** answer *"where in a distributed call path did time/errors go?"* — they show the causal, end-to-end path of a single request across services. The trade-off is cost vs detail: metrics are cheap but lose per-event context; logs and traces are detailed but expensive to store at full fidelity, so you sample them. You need all three because each answers a question the others cannot: metrics tell you *something* is wrong, traces tell you *where*, and logs tell you *why*.

**Key points**
- Metrics: aggregatable numeric series — detect & alert (is it broken, how much)
- Logs: discrete events with rich context — forensic detail (why)
- Traces: causal request path across services — locate (where)
- Trade-off is cost vs per-event fidelity; sample logs/traces, keep metrics cheap

**Follow-ups**
- Where do exemplars and structured-log trace IDs fit as the 'glue' between pillars?
- Why are metrics a poor place to put high-cardinality data like user IDs?

---

#### 2. How is observability different from monitoring? Why does the distinction matter for a senior engineer?

*Difficulty:* 🟡 medium  ·  *Tags:* `observability`, `monitoring`, `cardinality`, `concepts`

**Monitoring** is asking *predefined* questions: you decide in advance what to measure and alert on (CPU > 80%, error rate > 1%). It answers *known unknowns*. **Observability** is the property of a system that lets you ask *new, arbitrary* questions about its internal state from its outputs, *without shipping new code* — it targets *unknown unknowns*. Monitoring is a subset of observability. The distinction matters because modern distributed systems fail in novel, emergent ways you didn't anticipate; a system that only emits a fixed set of dashboards forces you to deploy new instrumentation mid-incident. High-cardinality, high-dimensionality wide events (e.g. structured spans/logs with many attributes) make a system observable because you can slice by `customer_id`, `region`, `build_sha` after the fact. The trade-off: arbitrary-question observability (cardinality) is expensive, so in practice you pair cheap pre-aggregated metrics for alerting with sampled wide events for exploration.

**Key points**
- Monitoring = predefined questions / known unknowns; observability = ad-hoc questions / unknown unknowns
- Monitoring is a subset of observability
- Observability needs high-dimensionality wide events to slice after the fact
- Cost trade-off: cheap metrics for alerts, sampled wide events for exploration

**Follow-ups**
- Can a system be heavily monitored but not observable? Give an example.
- What property of your telemetry determines how many distinct questions you can ask?

---

## Metrics & Prometheus Model

#### 3. Explain Prometheus's pull-based model and exposition format. What are the operational trade-offs of pull vs push?

*Difficulty:* 🟡 medium  ·  *Tags:* `prometheus`, `pull`, `exposition-format`, `scraping`

Prometheus **scrapes** (pulls) an HTTP `/metrics` endpoint on each target at a fixed interval; targets are discovered via service discovery (Kubernetes, Consul, file SD). The endpoint returns the **text exposition format**: one sample per line as `metric_name{label="value"} 42.0 [timestamp]`, with `# HELP` and `# TYPE` comment lines. Pull advantages: Prometheus controls scrape timing and rate; a failed scrape itself becomes a signal (`up == 0`); targets don't need to know where Prometheus lives; easy to run a target locally and curl it. Pull weaknesses: short-lived/batch jobs may die before being scraped (solved with the **Pushgateway**), and targets behind NAT/firewalls are hard to reach. Push systems (StatsD, OTLP push) suit ephemeral jobs and serverless but make the collector a bottleneck and lose the free liveness signal. Prometheus deliberately chose pull for operational simplicity and the built-in health check.

**Key points**
- Pull = Prometheus scrapes target /metrics over HTTP on an interval via service discovery
- Text format: name{labels} value [ts], with # HELP/# TYPE
- Pull gives a free liveness signal (up metric) and central control of timing
- Pushgateway bridges short-lived/batch jobs; push suits ephemeral/serverless


```
# HELP http_requests_total Total HTTP requests.
# TYPE http_requests_total counter
http_requests_total{method="GET",status="200"} 10247
http_requests_total{method="POST",status="500"} 3
```

**Follow-ups**
- Why is the Pushgateway an anti-pattern for anything except batch jobs?
- How does the `up` metric let you alert on a service being completely down?

---

#### 4. Walk through Prometheus's four metric types. When do you choose each?

*Difficulty:* 🟡 medium  ·  *Tags:* `prometheus`, `counter`, `gauge`, `histogram`, `summary`

**Counter**: monotonically increasing value (requests, errors, bytes) — only goes up, resets to 0 on restart. You almost always query it through `rate()`/`increase()`, never the raw value. Use for *things you count*. **Gauge**: a value that goes up and down (in-flight requests, queue depth, memory, temperature). Use for *current state / point-in-time levels*. **Histogram**: samples observations into cumulative buckets (`_bucket{le="..."}`) plus `_sum` and `_count`. Buckets are pre-chosen; aggregatable across instances and supports `histogram_quantile()` for percentiles — use for latency/size distributions. **Summary**: computes φ-quantiles (e.g. p99) *client-side* in a sliding window, exposing `_sum`, `_count`, and `{quantile="0.99"}`. Cheaper to query but **not aggregatable across instances** and quantiles are fixed at instrumentation time. Rule of thumb: prefer **histograms** for latency because they aggregate; use summaries only when you need a precise single-instance quantile and can't pre-pick buckets.

**Key points**
- Counter: monotonic up-only; query via rate()/increase() (counts)
- Gauge: up/down current level (in-flight, queue depth, memory)
- Histogram: pre-chosen cumulative buckets + _sum/_count; aggregatable, supports histogram_quantile
- Summary: client-side quantiles, NOT aggregatable across instances, fixed quantiles
- Default to histograms for latency precisely because summaries can't be aggregated

**Follow-ups**
- Why can't you average summary p99s across 10 pods to get a fleet p99?
- What are Prometheus native/exponential histograms and why were they introduced?

---

#### 5. What is cardinality explosion, what causes it, and how do you prevent it when instrumenting Go services?

*Difficulty:* 🟠 hard  ·  *Tags:* `cardinality`, `prometheus`, `labels`, `tsdb`, `scaling`

Each unique combination of label values for a metric is a separate **time series** that Prometheus stores in memory and on disk. **Cardinality** is the number of those series. It *explodes* when you put unbounded or high-cardinality values into labels — `user_id`, `email`, full `request_path` with IDs, `trace_id`, raw error strings. A single metric with `user_id` can become millions of series, blowing up memory, slowing queries, and crashing the TSDB. Total cardinality is roughly the *product* of each label's distinct values, so adding one bad label multiplies everything. Prevention: only use **bounded, low-cardinality** labels (HTTP method, status class `2xx/5xx`, route *template* `/users/:id` not `/users/12345`, region); never put IDs, timestamps, or free-form text in labels; cap or normalize values before they become labels; move high-cardinality detail to **logs/traces** where it belongs. Audit with `topk(20, count by (__name__)({__name__=~".+"}))` and Prometheus's `tsdb` status page, and set per-tenant series limits.

**Key points**
- Cardinality = number of unique label-value combinations = number of time series
- Total cardinality ≈ product of each label's distinct values
- Caused by unbounded labels: user_id, full path with IDs, trace_id, raw error text
- Use templated routes /users/:id, status class, region — never IDs in labels
- Push high-cardinality data into logs/traces; audit with count by series and set limits


```
// BAD: unbounded label -> one series per user, per path
reqs.WithLabelValues(userID, fullPath).Inc()

// GOOD: bounded labels only
reqs.WithLabelValues(r.Method, routeTemplate, statusClass).Inc()
```

**Follow-ups**
- How would you detect which metric is driving a Prometheus OOM?
- Why does relabeling/aggregation at scrape time help, and what does it cost you?

---

#### 6. Show how you'd instrument a Go HTTP handler with client_golang. What are the gotchas with registration and label usage?

*Difficulty:* 🟡 medium  ·  *Tags:* `go`, `client_golang`, `promauto`, `histogram`, `instrumentation`

You define collectors (typically `*Vec` types for labels), register them with a registry (often via `promauto`), and call `.Inc()`/`.Observe()` in your handler, then expose `promhttp.Handler()` on `/metrics`. Key gotchas: (1) **register once at init**, not per-request — duplicate registration panics; use `promauto` or package-level vars. (2) Use **bounded label sets**; pre-declare them where possible so series exist (and read as 0) before the first event. (3) For latency, use a **Histogram with explicit buckets** tuned to your SLOs (e.g. `[]float64{.005,.01,.025,.05,.1,.25,.5,1,2.5,5}`) — default buckets rarely match your latency profile. (4) Wrap timing with `prometheus.NewTimer(hist).ObserveDuration()` via `defer`. (5) Beware label-value explosion from `WithLabelValues` arguments derived from user input. Below is a typical middleware.

**Key points**
- Register collectors once at init (promauto/package vars) — re-registration panics
- Use *Vec types with bounded labels; pre-declare to expose 0-valued series
- Tune histogram buckets to your SLO, not the defaults
- Time with NewTimer(...).ObserveDuration() in a defer
- Never feed user input directly into WithLabelValues


```go
var httpDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
    Name:    "http_request_duration_seconds",
    Help:    "Request latency.",
    Buckets: []float64{.005, .01, .025, .05, .1, .25, .5, 1, 2.5, 5},
}, []string{"method", "route", "status"})

func instrument(route string, next http.HandlerFunc) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        sw := &statusWriter{ResponseWriter: w, code: 200}
        timer := prometheus.NewTimer(prometheus.ObserverFunc(func(v float64) {
            httpDuration.WithLabelValues(r.Method, route, strconv.Itoa(sw.code)).Observe(v)
        }))
        defer timer.ObserveDuration()
        next(sw, r)
    }
}
```

**Follow-ups**
- Why prefer a custom registry over the default global registry in libraries?
- How do you avoid double-counting when a handler can panic mid-request?

---

## RED, USE & Golden Signals

#### 7. Compare the RED and USE methods. When do you reach for each?

*Difficulty:* 🟡 medium  ·  *Tags:* `red`, `use`, `methodology`, `slo`

**RED** (Rate, Errors, Duration) is a **request-centric** method for *services* you can send traffic to: how many requests/sec, how many are failing, and how long they take. It's what your users feel, so it maps directly to SLOs and symptom-based alerting. **USE** (Utilization, Saturation, Errors) is a **resource-centric** method for *physical/virtual resources* (CPU, memory, disk, network, connection pools): how busy is it, how much work is queued/waiting beyond what it can serve, and is it throwing errors. RED tells you *the service is slow*; USE tells you *which resource is the bottleneck causing it*. You use RED on every service for user-facing health and alerting, and USE on the infrastructure underneath for root-causing. They're complementary: RED catches the symptom, USE explains the cause. Saturation (queueing) is the most predictive leading indicator in USE because it rises before utilization hits 100%.

**Key points**
- RED = Rate, Errors, Duration — request-centric, for services, maps to user experience/SLOs
- USE = Utilization, Saturation, Errors — resource-centric, for CPU/mem/disk/pools
- RED = symptom (service slow); USE = cause (which resource is the bottleneck)
- Saturation/queueing is the best leading indicator — rises before 100% utilization

**Follow-ups**
- How would saturation manifest before utilization in a connection-pool-bound service?
- Which method do you alert on, and which do you keep for dashboards/debugging?

---

#### 8. What are Google's four golden signals, and how do they relate to RED/USE?

*Difficulty:* 🟢 warm-up  ·  *Tags:* `golden-signals`, `sre`, `latency`, `saturation`

From the Google SRE book, the four golden signals are **latency**, **traffic**, **errors**, and **saturation**. **Latency** = how long requests take (track success and error latency *separately* — fast 500s skew your averages). **Traffic** = demand on the system (req/s, transactions/s). **Errors** = rate of failed requests (explicit 5xx, but also implicit wrong-content or policy failures). **Saturation** = how 'full' the most constrained resource is, the leading indicator of impending trouble. They overlap with RED (latency↔Duration, traffic↔Rate, errors↔Errors) but add **saturation** from the USE side, making golden signals a practical superset: if you measure only four things on a user-facing service, measure these. The deliberate emphasis is that latency and saturation should be split out and watched — most real incidents announce themselves as rising saturation and tail latency before the error rate moves.

**Key points**
- Latency, Traffic, Errors, Saturation (Google SRE)
- Measure success vs error latency separately — fast errors distort the signal
- Golden signals ≈ RED + saturation from USE
- Saturation is the leading indicator; latency tail often moves before errors

**Follow-ups**
- Why measure error latency separately from success latency?
- If you could alert on only one golden signal, which and why?

---

## Histograms, Percentiles & PromQL

#### 9. Why are averages misleading for latency, and why must you use histograms/percentiles instead?

*Difficulty:* 🟡 medium  ·  *Tags:* `percentiles`, `latency`, `averages`, `tail`

An average collapses a whole distribution into one number and is dominated by the bulk while hiding the **tail**. If 99% of requests take 10ms and 1% take 5s, the mean (~60ms) looks fine, yet 1 in 100 users is having a terrible experience — and at scale that 1% is thousands of people, often hitting your most active customers (who make the most requests). Averages also can't be reasoned about for SLOs ("99% of requests under 200ms" is a percentile statement, not a mean). Latency distributions are right-skewed and multimodal (cache hit vs miss, GC pauses, retries), so the mean sits between modes and describes nobody. Histograms preserve the *shape* of the distribution in buckets, letting you compute p50/p90/p99/p99.9 and watch the tail independently. Senior practice: alert and report on high percentiles (p99/p99.9), never the average, because the tail is where outages and angry users live.

**Key points**
- Averages are dominated by the bulk and hide the right-skewed tail
- 1% bad at scale = thousands of users, often your heaviest users
- SLOs are percentile statements, not means
- Histograms preserve distribution shape -> p50/p90/p99/p99.9; watch the tail

**Follow-ups**
- What is the 'tail at scale' problem (Dean & Barroso)?
- Why might p50 look healthy while p99 is on fire?

---

#### 10. Why can't you average percentiles across instances, and how does histogram_quantile solve it?

*Difficulty:* 🟠 hard  ·  *Tags:* `promql`, `histogram_quantile`, `percentiles`, `aggregation`

Percentiles are **not linearly aggregatable**: the p99 of a fleet is *not* the average (or sum) of each instance's p99. Averaging precomputed quantiles is mathematically meaningless — you'd need the underlying distributions, not their summary points. Imagine two pods: one with all fast requests (p99=10ms) and one overloaded (p99=2s). Averaging gives ~1s, but if the slow pod also served far more traffic, the true fleet p99 is much closer to 2s. This is exactly why **summaries** (client-computed quantiles) can't be merged across instances. **Histograms** fix this because *buckets are additive*: you `sum` the per-bucket counts across all instances first, reconstructing the combined distribution, and only *then* interpolate the quantile. `histogram_quantile(0.99, sum by (le)(rate(http_request_duration_seconds_bucket[5m])))` does exactly that — sum the rate of each bucket across instances grouped by `le`, then estimate p99. The accuracy is bounded by your bucket boundaries (linear interpolation within a bucket), so bucket choice matters.

**Key points**
- Percentiles are not linearly aggregatable — avg of p99s is meaningless
- Summaries can't be merged across instances for this reason
- Histogram buckets ARE additive: sum bucket counts first, then interpolate
- histogram_quantile(0.99, sum by (le)(rate(...bucket[5m])))
- Accuracy limited by bucket granularity (linear interpolation within a bucket)


```
histogram_quantile(
  0.99,
  sum by (le) (rate(http_request_duration_seconds_bucket[5m]))
)
```

**Follow-ups**
- Why must the `sum by (le)` keep the `le` label and aggregate everything else?
- How do native (exponential) histograms improve quantile accuracy without pre-chosen buckets?

---

#### 11. Write the PromQL for request rate, error ratio, and p99 latency for a service. Why rate() before sum, and why the time window matters.

*Difficulty:* 🟡 medium  ·  *Tags:* `promql`, `rate`, `error-ratio`, `p99`

Request **rate**: `sum(rate(http_requests_total[5m]))`. **Error ratio**: `sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m]))`. **p99 latency**: `histogram_quantile(0.99, sum by (le)(rate(http_request_duration_seconds_bucket[5m])))`. You must apply **`rate()` (or `increase()`) to a counter *before* aggregating**, because counters reset to 0 on restart; `rate()` is reset-aware and computes per-second increase over the range, whereas summing raw counters across pods and then taking a rate would produce garbage spikes at every restart. The **range window** (`[5m]`) is a smoothing/sensitivity trade-off: too short (`[1m]`) is noisy and may miss data if it's shorter than ~4× the scrape interval (`rate` needs ≥2 samples); too long (`[1h]`) smooths over real spikes and lags during incidents. A common rule is a window ≥ 4× the scrape interval, sized to the alert's evaluation cadence.

**Key points**
- rate() must wrap the counter BEFORE sum — it's reset-aware; sum-then-rate breaks on restarts
- Error ratio = rate(5xx) / rate(total)
- p99 = histogram_quantile over sum by (le) of bucket rates
- Window is a noise vs lag trade-off; keep it ≥ ~4× scrape interval


```
# rate
sum(rate(http_requests_total[5m]))

# error ratio
sum(rate(http_requests_total{status=~"5.."}[5m]))
  / sum(rate(http_requests_total[5m]))

# p99 latency
histogram_quantile(0.99,
  sum by (le) (rate(http_request_duration_seconds_bucket[5m])))
```

**Follow-ups**
- When do you use irate() vs rate(), and why is irate() risky for alerting?
- What happens if your range window is shorter than the scrape interval?

---

## Distributed Tracing & OpenTelemetry

#### 12. Define trace, span, and context propagation. How does a trace get stitched together across services?

*Difficulty:* 🟡 medium  ·  *Tags:* `tracing`, `span`, `context-propagation`, `trace-id`

A **trace** represents the end-to-end journey of one request and is a tree (DAG) of **spans**. A **span** is a single named, timed operation (an HTTP handler, a DB query, an RPC) with a start/end timestamp, a `trace_id`, a unique `span_id`, a `parent_span_id`, plus attributes, events, and a status. Spans within one trace share the same `trace_id`; parent/child links form the tree. **Context propagation** is how the `trace_id` and current `span_id` travel from one service to the next: the caller serializes the active span context into request **headers**, and the callee extracts them and starts a child span. In-process, the context rides on Go's `context.Context`; across the network it rides on HTTP/gRPC headers via a **propagator**. Without propagation each service would create disconnected traces. The collector/backend reassembles the tree by `trace_id` and `parent_span_id`, so you can see exactly which downstream hop consumed the time.

**Key points**
- Trace = tree of spans for one request; span = named, timed unit of work
- Span carries trace_id, span_id, parent_span_id, attributes, events, status
- Propagation: serialize span context into headers; callee extracts and starts a child
- In-process via context.Context, cross-process via headers + propagator
- Backend reassembles the tree by trace_id/parent_span_id

**Follow-ups**
- What breaks the trace if one hop in the chain doesn't propagate context?
- How do you propagate context across async boundaries like a message queue?

---

#### 13. What is W3C Trace Context? What do the traceparent and tracestate headers carry?

*Difficulty:* 🟡 medium  ·  *Tags:* `w3c`, `traceparent`, `tracestate`, `propagation`

**W3C Trace Context** is the standard HTTP propagation format that lets tracing interoperate across vendors and languages (replacing proprietary formats like B3/Zipkin and Jaeger's). It defines two headers. **`traceparent`** is the required one: `version-trace_id-parent_id-trace_flags`, e.g. `00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01`. The 16-byte (32-hex) `trace_id` and 8-byte `parent_id` (the caller's span id) identify the trace and the parent span; `trace_flags` low bit is the **sampled** flag, telling downstream whether this trace was sampled. **`tracestate`** is optional and carries vendor-specific key/value pairs (`vendor1=abc,vendor2=def`), letting multiple systems attach state without clobbering each other. Standardizing this means a Go service using OpenTelemetry and a downstream Java service using a different vendor still join the same trace. The sampled flag is the basis of **head sampling** consistency: a sampling decision made at the edge propagates so the whole trace is kept or dropped together.

**Key points**
- W3C Trace Context = vendor-neutral HTTP propagation standard
- traceparent: version-trace_id-parent_id-trace_flags (sampled bit in flags)
- tracestate: optional vendor-specific key/value pairs
- Enables cross-vendor/cross-language interop and consistent sampling decisions


```
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
tracestate:  rojo=00f067aa0ba902b7,congo=t61rcWkgMzE
```

**Follow-ups**
- Why is propagating the sampled flag critical for trace completeness?
- What problem does tracestate solve that a single header can't?

---

#### 14. Describe the OpenTelemetry architecture: SDK vs Collector. Why run a Collector?

*Difficulty:* 🟠 hard  ·  *Tags:* `opentelemetry`, `collector`, `otlp`, `sdk`, `architecture`

**OpenTelemetry (OTel)** splits into the **API** (vendor-neutral instrumentation surface you code against), the **SDK** (the in-process implementation: providers, samplers, span processors, batchers, and **exporters** that emit OTLP), and the **Collector** (a standalone service). Your Go app uses the API/SDK to produce spans/metrics/logs and exports them over **OTLP** (gRPC/HTTP). The **Collector** receives that telemetry (receivers), transforms it (processors: batching, tail sampling, attribute scrubbing, redaction), and forwards it (exporters) to one or more backends (Jaeger, Tempo, Prometheus, vendors). You run a Collector because it **decouples your app from backends**: you change destinations, add tail sampling, drop PII, or fan out to multiple vendors via Collector config without redeploying services. It also offloads batching/retry/buffering from app processes and centralizes cross-cutting policy. Pattern: a lightweight **agent** Collector as a sidecar/daemonset near the app for low-latency export, feeding a **gateway** Collector pool that does heavier processing like tail-based sampling.

**Key points**
- API (instrument) vs SDK (samplers, processors, exporters) vs Collector (standalone)
- App exports OTLP (gRPC/HTTP) to the Collector
- Collector = receivers -> processors -> exporters; decouples app from backends
- Enables tail sampling, PII scrubbing, multi-backend fan-out without redeploy
- Agent (sidecar/daemonset) + gateway pool topology for heavy processing


```go
// Go SDK: tracer provider with batch processor + OTLP exporter
exp, _ := otlptracegrpc.New(ctx)
tp := sdktrace.NewTracerProvider(
    sdktrace.WithBatcher(exp),
    sdktrace.WithSampler(sdktrace.ParentBased(sdktrace.TraceIDRatioBased(0.1))),
    sdktrace.WithResource(res),
)
otel.SetTracerProvider(tp)
otel.SetTextMapPropagator(propagation.TraceContext{})
```

**Follow-ups**
- Why is tail sampling only feasible in the (gateway) Collector, not the SDK?
- What's the difference between Jaeger and Tempo as trace backends in cost terms?

---

#### 15. Head-based vs tail-based sampling: how do they work, and what are the trade-offs?

*Difficulty:* 🟠 hard  ·  *Tags:* `sampling`, `head-sampling`, `tail-sampling`, `collector`

**Head sampling** decides whether to keep a trace **at the start**, at the root span, before you know the outcome — typically a probabilistic ratio (e.g. keep 10%) made consistently and propagated via the sampled flag so the whole trace is kept or dropped together. It's cheap, stateless, and bounds volume predictably, but it's blind: you'll *randomly drop the rare slow/error traces you most want* and keep boring fast ones. **Tail sampling** decides **after the full trace is assembled**, in the Collector, so it can keep 100% of traces that errored or exceeded a latency threshold and sample down the successful bulk. It captures exactly the interesting traces but requires **buffering all spans of a trace until it completes** (memory + a decision window), is stateful, and needs all spans of a trace to land on the same Collector instance (consistent routing), making it operationally heavier and costlier to scale. Common production setup: light head sampling to bound ingest, then tail sampling in a gateway Collector to guarantee error/slow traces survive.

**Key points**
- Head: decide at root before outcome; cheap, stateless, propagated; blind to errors/slow
- Tail: decide in Collector after trace completes; keep all errors/slow, sample the rest
- Tail needs buffering, a decision window, and same-trace-to-same-collector routing
- Production: light head sampling + tail sampling in gateway for interesting traces

**Follow-ups**
- How do you route all spans of a trace to the same tail-sampling Collector?
- What's the memory cost model for tail sampling, and how do you bound it?

---

## Correlation: Logs, Traces & Exemplars

#### 16. How do you correlate the three pillars in practice? Explain trace IDs in logs and metric exemplars.

*Difficulty:* 🟠 hard  ·  *Tags:* `correlation`, `exemplars`, `trace-id`, `logs`

Correlation is the glue that makes three separate pillars one investigation. **Trace ID in logs**: inject the active `trace_id` (and `span_id`) from `context.Context` into every structured log line, so when you find an error log you can pivot to the full distributed trace, and from a slow span you can jump to its logs. This requires propagating `context.Context` everywhere and a logging setup that reads the span context. **Exemplars** connect metrics to traces: an exemplar is a sampled trace ID attached to a specific histogram bucket observation. In Grafana you click a spike on a latency histogram and jump straight to an *example trace* that landed in that slow bucket — turning an aggregate ("p99 is high") into a concrete ("here's one of the slow requests"). Together, the workflow is: a **metric** alerts you something is wrong → an **exemplar** takes you to a representative slow/failed **trace** → the trace's `trace_id` ties to **logs** that explain why. Without correlation you have three disconnected tools; with it you have observability.

**Key points**
- Inject trace_id/span_id from context into structured logs to pivot log<->trace
- Exemplar = sampled trace ID attached to a histogram bucket observation
- Click a metric spike -> exemplar -> a real example trace (aggregate -> concrete)
- Workflow: metric alerts -> exemplar -> trace -> logs explain why


```go
// Attach exemplar (trace ID) to a histogram observation
sc := trace.SpanContextFromContext(ctx)
if sc.IsSampled() {
    obs.(prometheus.ExemplarObserver).ObserveWithExemplar(
        seconds, prometheus.Labels{"trace_id": sc.TraceID().String()})
}
```

**Follow-ups**
- What must be true about your logging library to auto-inject trace IDs?
- Why are exemplars only useful when the referenced trace was actually sampled/kept?

---

## Structured Logging in Go (slog)

#### 17. Why structured logging over printf-style? How does Go's log/slog change this, and what's the performance angle?

*Difficulty:* 🟡 medium  ·  *Tags:* `go`, `slog`, `structured-logging`, `json`

**Structured logging** emits key/value records (usually JSON) instead of free-form interpolated strings, so logs are **machine-parseable**: you can index, filter, and aggregate by field (`status=500 AND region=eu`) in Loki/Elasticsearch without brittle regex. Printf logs are human-readable but un-queryable at scale and lose type information. Go 1.21's **`log/slog`** is the standard-library answer: a `Logger` writes to a pluggable `Handler` (`JSONHandler` for prod, `TextHandler` for dev), with leveled methods (`Debug/Info/Warn/Error`) and typed attributes (`slog.Int`, `slog.String`). Performance angle: prefer the **strongly-typed `slog.Attr` constructors** and `LogAttrs` over `...any` key/value pairs to avoid allocations/boxing on hot paths; use `logger.With(...)` to bind common fields (request_id, trace_id) once; and gate expensive fields behind `Enabled(level)` so you don't build them when the level is disabled. `slog` also standardizes the ecosystem so libraries can emit structured records into whatever backend you choose via the handler interface.

**Key points**
- Structured = key/value (JSON), machine-queryable; printf is human-only and un-aggregatable
- slog: Logger -> Handler (JSON for prod, Text for dev), leveled, typed attrs
- Use LogAttrs/typed slog.Attr to cut allocations on hot paths
- Bind common fields with With(...); gate costly fields with Enabled(level)


```go
logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
log := logger.With(slog.String("service", "checkout"))
log.LogAttrs(ctx, slog.LevelError, "payment failed",
    slog.String("order_id", id),
    slog.Int("attempt", n),
    slog.String("trace_id", traceID))
```

**Follow-ups**
- How would you write a custom slog.Handler that injects trace_id from context automatically?
- Why is LogAttrs faster than the variadic any-based methods?

---

#### 18. What should you log and what should you never log? How do you handle log levels and noisy logs at scale?

*Difficulty:* 🟡 medium  ·  *Tags:* `logging`, `pii`, `log-levels`, `sampling`

**Log**: request/operation boundaries with IDs (request_id, trace_id, user_id where allowed), decisions and state transitions, error conditions with enough context to act, and external-call outcomes (latency, status). **Never log**: secrets and credentials (passwords, tokens, API keys, session cookies), PII beyond policy (full PANs, SSNs, raw emails in plaintext) — this is a security/compliance liability and shows up in log indexes forever. Scrub or hash sensitive fields *before* logging, ideally centrally in the handler. **Levels**: `Error` for actionable failures, `Warn` for recoverable/degraded conditions, `Info` for significant business events, `Debug` for development detail (off in prod by default, dynamically toggleable). The common anti-pattern is logging at the wrong level — noisy `Error` logs cause alert fatigue and bury real ones. **Noisy logs at scale**: sample repetitive logs (e.g. keep 1-in-N of a known recurring event, or use rate-limited/dedup'd logging), drop or aggregate hot-loop logs, and push high-cardinality detail to traces. The goal is signal density: every line should be worth its storage and an operator's attention.

**Key points**
- Log: boundaries + IDs, decisions, errors with actionable context, external-call outcomes
- Never log secrets/credentials or PII; scrub/hash centrally before emitting
- Levels: Error=actionable, Warn=degraded, Info=business event, Debug=dev (toggleable)
- Wrong-level logging causes alert fatigue; sample/rate-limit/dedup noisy logs

**Follow-ups**
- How do you dynamically raise log level for one service mid-incident without redeploy?
- Where do you implement PII redaction so a careless caller can't bypass it?

---

## Alerting: SLI/SLO & Burn-Rate

#### 19. Define SLI, SLO, and error budget. How do they shape your alerting strategy?

*Difficulty:* 🟡 medium  ·  *Tags:* `sli`, `slo`, `error-budget`, `alerting`

An **SLI** (Service Level Indicator) is a *measured* ratio of good events to valid events — e.g. `successful requests / total requests`, or `requests under 200ms / total`. An **SLO** (Service Level Objective) is the *target* for that SLI over a window — e.g. 99.9% over 28 days. The **error budget** is the allowed failure: `1 − SLO` (0.1% over 28 days ≈ 40m of full downtime), the budget of badness you're permitted to spend on risk, deploys, and experiments. This reframes alerting from arbitrary thresholds to *budget consumption*: you don't page on "CPU 85%" (a cause that may not hurt users); you page when you're **burning the error budget too fast** to meet the SLO. SLOs also drive engineering decisions — if the budget is exhausted, you freeze risky changes and prioritize reliability; if it's healthy, you can ship faster. The discipline forces you to define *what users actually care about* (success and latency) and alert on *that symptom*, not every internal fluctuation, which is the core of reducing alert fatigue.

**Key points**
- SLI = good/valid event ratio (measured); SLO = target over a window
- Error budget = 1 − SLO; the allowed amount of badness
- Alert on budget burn (symptom), not arbitrary cause thresholds
- Budget governs whether you ship features or freeze for reliability

**Follow-ups**
- How do you pick the SLI denominator (what counts as a 'valid' event)?
- What do you do operationally when the error budget is fully spent?

---

#### 20. Explain multi-window, multi-burn-rate alerting. Why is it better than a static threshold?

*Difficulty:* 🔴 staff  ·  *Tags:* `burn-rate`, `slo`, `alerting`, `multi-window`

**Burn rate** is how fast you're consuming the error budget relative to the SLO window: a burn rate of 1 spends the whole budget exactly over the window; a burn rate of 14.4 spends it in ~1/14.4 of the window. Alerting on burn rate ties the page directly to SLO risk. **Multi-window, multi-burn-rate** (from the Google SRE workbook) uses several alerts at different sensitivities: a **fast/high-burn** alert (e.g. burn ≥ 14.4 over a 1h window, confirmed by a 5m short window) pages immediately for catastrophic loss (budget gone in ~2 days); a **slow/low-burn** alert (e.g. burn ≥ 3 over 6h, or ~1 over a day) pages or tickets for gradual erosion. The **short confirmation window** prevents flapping: both the long and short window must breach so a brief blip doesn't page. This beats a static threshold (e.g. "error rate > 1%") because it's **SLO-relative** (the same 1% may be fine or an emergency depending on your budget), it has **good precision and recall** (catches both fast outages and slow leaks), and it **reduces false pages** via the dual-window confirmation, cutting alert fatigue.

**Key points**
- Burn rate = budget-consumption speed; burn 1 spends budget over the full window
- Multi-window/multi-burn: fast high-burn pages now, slow low-burn tickets/erosion
- Short confirmation window prevents flapping (both windows must breach)
- SLO-relative + good precision/recall beats static error-rate thresholds, cuts fatigue


```
# Fast-burn page: 14.4x over 1h AND 5m (1h budget burn alert)
(
  sum(rate(http_requests_total{status=~"5.."}[1h]))
    / sum(rate(http_requests_total[1h])) > 14.4 * (1 - 0.999)
)
and
(
  sum(rate(http_requests_total{status=~"5.."}[5m]))
    / sum(rate(http_requests_total[5m])) > 14.4 * (1 - 0.999)
)
```

**Follow-ups**
- How do you choose the 14.4 / 6 / 3 burn-rate thresholds from the SLO?
- Why include both a long and a short window in each alert condition?

---

#### 21. What's the difference between symptom-based and cause-based alerting, and how do you reduce alert fatigue?

*Difficulty:* 🟡 medium  ·  *Tags:* `alerting`, `symptom`, `cause`, `alert-fatigue`, `runbooks`

**Symptom-based** alerts fire on *what the user experiences* — high error rate, high latency, SLO burn. **Cause-based** alerts fire on *internal conditions* that might lead to a symptom — high CPU, a full disk, a crashed replica, queue depth. The senior principle: **page on symptoms, diagnose with causes.** A cause-based alert often pages when users are fine (CPU is 90% but latency is healthy) or, worse, *fails to page* when a cause you didn't anticipate degrades users. Symptom alerts have higher signal-to-noise because they're tied to actual impact. To reduce **alert fatigue**: (1) every page must be **actionable and urgent** — if no human action is needed now, make it a ticket or dashboard, not a page; (2) alert on SLO burn rate, not raw thresholds; (3) **deduplicate and group** related alerts (one incident, not 50 pages); (4) add **inhibition** so an upstream outage suppresses dependent downstream alerts; (5) tune out flappy alerts with confirmation windows; (6) attach a **runbook** to every alert so on-call knows the first step. Fatigue is a reliability risk: a noisy pager trains people to ignore the one page that mattered.

**Key points**
- Symptom = user-facing (errors/latency/SLO burn); cause = internal (CPU/disk/queue)
- Page on symptoms, diagnose with causes; cause alerts page when users are fine or miss novel failures
- Every page must be urgent + actionable; else ticket/dashboard
- Dedup/group, inhibition for upstream outages, confirmation windows, runbook per alert

**Follow-ups**
- Give an example where a cause-based alert pages but users are unaffected.
- How does Alertmanager inhibition prevent an alert storm during a dependency outage?

---

#### 22. What makes an on-call rotation and runbooks effective? What's the role of the runbook during an incident?

*Difficulty:* 🟡 medium  ·  *Tags:* `on-call`, `runbooks`, `incident`, `mttr`

An effective **on-call** rotation has sustainable load (sane page volume — Google's guidance is ≤ ~2 actionable pages per shift), clear primary/secondary escalation, follow-the-sun or reasonable shift lengths, and a culture where pages drive **fixes**, not just acks. Every page should be *actionable*; chronic noise must be triaged in retros and eliminated, because the rotation's health is itself an SLO. A **runbook** is a concise, per-alert operational guide: what the alert means, the likely causes, the exact diagnostic queries/dashboards to open, and concrete mitigation steps (failover, scale up, roll back, drain). Its role during an incident is to **compress time-to-mitigate and lower the cognitive load** on a possibly half-asleep responder, encoding senior knowledge so any on-call can act consistently. Good runbooks are *tested* (links work, commands are current), focus on **mitigation before root-cause** (stop the bleeding, investigate later), and are improved after every incident via blameless postmortems. Runbook quality and page actionability are the two levers that most reduce MTTR and on-call burnout.

**Key points**
- Sustainable page load (~≤2 actionable/shift), clear escalation, pages drive fixes
- Runbook: meaning, likely causes, exact diagnostics, concrete mitigations per alert
- Role: cut time-to-mitigate + cognitive load; encode senior knowledge
- Mitigate before root-cause; keep runbooks tested and updated via blameless postmortems

**Follow-ups**
- How do you keep runbooks from rotting (stale commands/links)?
- Why prioritize mitigation over root-cause during the live incident?

---

## Dashboards, Cardinality & Cost at Scale

#### 23. How do you design effective Grafana dashboards for a service? What anti-patterns do you avoid?

*Difficulty:* 🟡 medium  ·  *Tags:* `grafana`, `dashboards`, `red`, `golden-signals`

Structure dashboards top-down around the **golden signals / RED**: a top row of latency (p50/p99), traffic, error rate, and saturation for the service at a glance, then drill-down rows (per-endpoint, per-dependency, resource USE panels) for diagnosis. Make them **answer questions, not display everything**: each panel should map to "is the service healthy?" or "if not, where?". Use template variables (service, region, instance) for reuse, show SLO/error-budget burn explicitly, and add exemplar links so a latency spike jumps to a trace. Anti-patterns: (1) **wall-of-graphs** vanity dashboards with 80 panels nobody reads; (2) plotting **averages** instead of percentiles; (3) panels with no clear question or threshold; (4) high-cardinality queries that are slow to render and hammer the TSDB; (5) dashboards that don't distinguish success vs error latency; (6) duplicating alerting logic in panels with no link to the actual alert/runbook. A good dashboard is the second screen you open after a page — the alert tells you *something's wrong*, the dashboard tells you *where to look next*.

**Key points**
- Top-down: golden-signals/RED overview row, then drill-down rows for diagnosis
- Every panel answers a question; use template vars + SLO burn + exemplar links
- Avoid wall-of-graphs vanity boards, averages over percentiles, undefined thresholds
- Avoid heavy high-cardinality queries that hammer the TSDB

**Follow-ups**
- How do you keep a query backing a panel from being too expensive at high cardinality?
- What belongs on an overview dashboard vs a drill-down dashboard?

---

#### 24. Observability cost explodes at scale. What are the main cost drivers across the three pillars and how do you control them?

*Difficulty:* 🟠 hard  ·  *Tags:* `cost`, `cardinality`, `sampling`, `retention`, `scaling`

Costs differ per pillar. **Metrics** cost scales with **active time series (cardinality)** and retention, not request volume — one bad label can 100× your TSDB bill. Control via cardinality discipline (bounded labels), recording rules to pre-aggregate hot queries, dropping unused series at scrape time with relabeling, and tiered retention (downsample old data). **Logs** cost scales with **volume × retention × indexing**; control via log sampling/rate-limiting, dropping debug in prod, structured logs to index only needed fields, and cheaper object-storage backends (Loki indexes labels, not full text). **Traces** cost scales with **span volume**; control with head sampling to bound ingest plus tail sampling to keep only interesting traces (errors/slow), and short retention for the sampled bulk. The overarching strategy: **keep cheap aggregates at full fidelity (metrics) and sample the expensive detail (logs/traces)**, push high-cardinality data out of metrics into sampled traces, and continuously audit the top cardinality/volume contributors. The failure mode is treating all telemetry as keep-everything-forever; senior practice is value-per-byte budgeting.

**Key points**
- Metrics cost = cardinality × retention (not traffic) — one label can explode it
- Logs cost = volume × retention × indexing — sample, drop debug, index few fields
- Traces cost = span volume — head + tail sampling, short retention for bulk
- Strategy: full-fidelity cheap aggregates, sample expensive detail, audit top contributors

**Follow-ups**
- How do recording rules reduce both query cost and dashboard latency?
- Why does pushing user_id from a metric label to a trace attribute save money?

---

## Debugging Production & OTel Vendor-Neutrality

#### 25. Your p99 latency is high but p50 is fine. Walk through how you'd debug this tail-latency problem.

*Difficulty:* 🔴 staff  ·  *Tags:* `tail-latency`, `p99`, `debugging`, `exemplars`, `saturation`

A healthy p50 with a bad p99 means *most* requests are fine but a minority are slow — a **tail-latency** problem, where the slowness is conditional, not systemic. Process: (1) Confirm it's real and find *which* requests — slice the latency histogram by labels (endpoint, region, instance, status) to see if the tail concentrates somewhere. (2) Check if it's **per-instance** (one bad pod: GC pauses, noisy neighbor, hot shard) vs **per-request-type** (a specific endpoint/query). USE metrics expose saturation: a saturated connection pool, thread pool, or disk queue produces a slow tail while the median stays fast. (3) Use **exemplars** to jump from the slow histogram bucket to actual **slow traces**, then read the span breakdown to find which downstream hop or DB query consumed the time. (4) Correlate with **logs** for those trace IDs to see the why (lock contention, retries, cold cache, large payload). Common tail causes: queueing/saturation, GC/stop-the-world pauses, lock contention, slow downstream dependency, cache misses, fan-out where the slowest of N parallel calls dominates ('tail at scale'), and uneven sharding. Mitigations: add capacity/reduce saturation, hedged requests, timeouts + retries with budget, fix the hot shard, tune GC. The key insight: **averages and p50 hide exactly the population that's hurting**, so you must drive the investigation from percentiles, exemplars, and per-dimension slicing.

**Key points**
- Good p50 + bad p99 = conditional tail slowness, not systemic
- Slice histogram by dimensions; isolate per-instance vs per-request-type
- Check USE saturation (pools/threads/disk queue) — classic tail cause
- Exemplar -> slow trace -> span breakdown -> logs for root cause
- Causes: queueing, GC pauses, locks, slow dependency, cache miss, fan-out tail, hot shard


```
# tail by endpoint: which route owns the high p99?
histogram_quantile(0.99,
  sum by (le, route) (rate(http_request_duration_seconds_bucket[5m])))

# is one instance the culprit?
histogram_quantile(0.99,
  sum by (le, instance) (rate(http_request_duration_seconds_bucket[5m])))
```

**Follow-ups**
- How do hedged requests trade extra load for a shorter tail?
- Why does parallel fan-out make tail latency worse as N grows?

---

#### 26. A spike happens at 14:32. Describe correlating it across metrics, traces, and logs to find root cause.

*Difficulty:* 🟠 hard  ·  *Tags:* `correlation`, `incident`, `debugging`, `trace-id`, `exemplars`

Use the pillars in their strengths, narrowing scope at each step. (1) **Metrics first — scope and timeline**: the alert/dashboard shows *what* spiked at 14:32 (error rate? p99? saturation?) and *where* by slicing labels (which service, endpoint, region, instance). Line it up against deploy/config-change markers and dependency dashboards — a change at 14:31 is a prime suspect. (2) **Traces — locate the slow/failed path**: from the spiking metric, use an **exemplar** to jump to a representative bad trace from that window, and read the span waterfall to see exactly which hop errored or blew its latency budget (e.g. the DB span went from 5ms to 800ms). This converts "the service is slow" into "this dependency is the cause." (3) **Logs — the why**: pivot on the `trace_id` from that trace to the structured logs of the implicated span/service to get the concrete reason (connection-pool exhausted, a specific error, a slow query, a poison message). (4) Confirm causality: does the timeline, the failing dependency, and the log reason all align, and does a change correlate? Then mitigate (roll back, scale, fail over) before full RCA. The discipline is **metrics for when/where → traces for which hop → logs for why**, with trace IDs and exemplars as the connective tissue; skipping correlation leaves you guessing across three disconnected tools.

**Key points**
- Metrics: scope when/where + line up against deploys/config changes
- Exemplar -> representative bad trace -> span waterfall finds the failing hop
- Pivot on trace_id to structured logs for the concrete reason
- Confirm timeline+dependency+log+change alignment, mitigate before full RCA

**Follow-ups**
- What if no trace was sampled for the spike window — how do you avoid that gap?
- How do deploy/version annotations on dashboards speed up correlation?

---

#### 27. What does OpenTelemetry's vendor-neutrality actually buy you, and where is it still leaky?

*Difficulty:* 🟠 hard  ·  *Tags:* `opentelemetry`, `vendor-neutral`, `otlp`, `semantic-conventions`

**Vendor-neutrality** means you instrument your code *once* against the **OTel API** and emit a standard wire format (**OTLP**), decoupling instrumentation from any backend. Concretely it buys you: (1) **portability** — switch from a SaaS vendor to Tempo/Jaeger/Prometheus, or fan out to several, by changing **Collector** config, not application code; (2) **no lock-in** on the most expensive thing to redo (instrumentation across hundreds of services); (3) **consistency** — one semantic-conventions schema (`http.request.method`, `db.system`) so dashboards and queries are portable; (4) **interop** via W3C Trace Context so polyglot services join one trace. Where it's still leaky: **semantic conventions** are still stabilizing (some signals/attributes are experimental and have churned, breaking dashboards on upgrade); **metrics and logs** matured later than tracing, so coverage/maturity is uneven across languages; backends differ in how they **interpret/store** OTLP, so some vendor-specific features (advanced analytics, specific UI affordances) still aren't portable; and you trade lock-in for **OTel's own complexity** (SDK config, Collector pipelines, version skew between SDK/Collector/conventions). Net: it eliminates the costly lock-in (instrumentation + protocol) while leaving thinner, manageable seams at the convention and backend-feature layer.

**Key points**
- Instrument once against OTel API, emit OTLP — decouples code from backend
- Buys portability, no instrumentation lock-in, consistent semantic conventions, W3C interop
- Leaky: conventions still stabilizing (dashboard churn), metrics/logs less mature than traces
- Backends interpret OTLP differently; you trade lock-in for OTel's own operational complexity

**Follow-ups**
- Why is instrumentation the most expensive thing to be locked into?
- How do you guard dashboards against semantic-convention changes on OTel upgrades?

---
