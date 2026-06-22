# Telemetry Cost & Sampling Strategy — Interview Questions

> **Topic:** [Telemetry Cost & Sampling Strategy Roadmap](README.md)
> **Focus:** Questions an interviewer can actually ask about controlling the cost and volume of logs, metrics, and traces without going blind — the three cost drivers, head vs tail sampling, cardinality, statistical correctness of sampled data, consistent decisions across services, the OTel Collector, the fidelity floor, and org-level cost strategy.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Conceptual / Foundational](#conceptual--foundational)
3. [Sampling — Head vs Tail](#sampling--head-vs-tail)
4. [Cardinality & Cost Drivers](#cardinality--cost-drivers)
5. [Statistical Correctness of Sampling](#statistical-correctness-of-sampling)
6. [Consistent Sampling Across Services](#consistent-sampling-across-services)
7. [The OTel Collector](#the-otel-collector)
8. [Tricky / Trap Questions](#tricky--trap-questions)
9. [System / Design Scenarios](#system--design-scenarios)
10. [Behavioral / Experience](#behavioral--experience)
11. [What I'd Ask a Candidate Now](#what-id-ask-a-candidate-now)
12. [Cheat Sheet](#cheat-sheet)
13. [Further Reading](#further-reading)
14. [Related Topics](#related-topics)

---

## Introduction

Telemetry-cost interviews are deceptively deep. The surface is easy — "what is sampling?", "head vs tail", "why is `user_id` a bad metric label" — and any junior should clear it. The real signal is in the second layer: *do you understand that sampling is a lie you tell on purpose, and do you know how to keep that lie statistically honest?* Can you explain why a 1% head sample silently throws away 99% of your errors, why you must multiply a sampled count by `1/sample_rate`, why two collectors can each make a "correct" sampling decision and still produce a broken half-empty trace, and why tail sampling fundamentally constrains your collector topology? Senior and staff interviews live almost entirely in that second layer.

This file is the question bank, graduated junior → staff. Trap questions also explain *why* the obvious instinct is wrong, because in production the wrong instinct is the expensive part — either it doesn't cut the bill (you pulled the wrong lever) or it cuts the wrong data (you sampled away the thing you needed at 3 a.m.). The scenario section is where staff candidates earn their title: given "the observability bill doubled overnight," can you diagnose under pressure, find which of three independent budgets leaked, and fix it without blinding the on-call? Two skills underpin the practical answers here — the **observability-stack** skill for choosing logs/metrics/traces tooling and the **monitoring-alerting** skill for SLOs and alert design — and strong candidates reason from those mental models rather than vendor trivia.

---

## Conceptual / Foundational

### Q: What is sampling, and why does telemetry need it at all?

Sampling is deliberately keeping only a *fraction* of your telemetry — almost always traces — and dropping the rest, to control cost. It is needed because telemetry cost scales with **volume, not value**: you pay to ship, store (for the whole retention window), and index every signal, and the vendor charges the same for the DEBUG line nobody read as for the ERROR that explained an outage. On a real system telemetry volume is *multiplicative* — more requests × more services × more spans per request × more fields per event — so it grows faster than traffic, and plenty of teams reach the point where the observability bill exceeds the compute bill of the system being observed. Sampling is the lever that decouples "what the app emits" from "what the backend bills you for." The art is choosing *which* fraction to keep so you cut the boring high-volume data and never the rare important data.

**What-if — "Why not just emit less in the code?"** Emitting less loses information at the source and couples cost control to your deploy cycle — to change the rate you ship code. The better seam is to emit freely and decide what to *keep* centrally, in the collector, where it's a config push.

### Q: Name the three cost drivers — one per signal — and the killer pattern for each.

There is no single "telemetry cost" lever; each signal fails expensive in a different way. **Metrics → cardinality**: cost is driven by the number of distinct label/tag combinations (the series count), and the killer is a high-cardinality label like `user_id` or `request_id` that creates one series per unique value. **Logs → volume**: cost is bytes × retention, and the classic killer is DEBUG left on in prod (plus fat JSON fields and long retention). **Traces → volume × spans-per-trace**: a single request can be 40 spans, and at high rps that's a firehose, so the killer is 100% sampling at scale. Knowing *which* driver is hurting tells you *which* lever to pull — and pulling the wrong one (shortening log retention to fix a metrics-cardinality bill) does literally nothing.

**What-if — "Why is it dangerous to treat them as one bill?"** Because they're three separate budgets with three separate leaks. A metrics spike is almost always a new high-cardinality label; a logs spike is a level left on; a traces spike is traffic growth meeting 100% sampling. One mental "telemetry bill" leads you to pull a random lever and watch the cost not move.

### Q: What are the three pillars, and why does the *cost economics* differ across them?

The three pillars are **metrics** (pre-aggregated numeric time series, constant-cost regardless of traffic), **logs** (timestamped event records whose cost scales with volume), and **traces** (causally-linked span trees per request whose cost scales with volume × spans). The economics differ because of *aggregation*: a counter incremented a billion times is still one series — emitting is free, the cost is the cardinality — whereas a log line written a billion times is a billion stored lines. This is why you **never sample metrics** (you control their cardinality instead) but you **do sample traces** (the per-request firehose). It's also why identity (`user_id`, full URL, request ID) belongs in logs and traces, where high cardinality is cheap, and never in a metric label, where it's a series-count bomb.

### Q: What is the "fidelity floor"?

The fidelity floor is the set of signals you keep at 100% no matter what the bill says: **errors, audit/security events, SLO-relevant data, and billing/usage data.** It exists because cost-cutting is supposed to remove the *boring* data, and these are the opposite of boring — sampling away an error trace defeats the entire purpose of having traces; sampling away an audit log can be illegal; sampling away an SLO signal corrupts the number your whole reliability program runs on; under-counting billing data costs you revenue. The practical test is the "3 a.m. test": *if the worst incident happened tonight, would I have needed this data?* If yes, it's on the floor. Everything above the floor is a candidate to sample; nothing below it is.

**What-if — "Isn't keeping errors at 100% just as expensive?"** No — in a healthy system errors are a small fraction of traffic (often well under 1%), so keeping 100% of errors plus 1% of normal traffic costs barely more than 1% flat, while preserving exactly the traces you'll open. The expensive part is the boring 99%, and that's the part you're allowed to cut.

---

## Sampling — Head vs Tail

### Q: Define head sampling and tail sampling, and the core trade-off.

**Head sampling** decides whether to keep a trace at its **start**, before the request runs — typically a weighted coin flip (`keep with probability 0.01`). It is cheap, stateless, and every service can do it independently, but it is **blind**: the coin is flipped before anything happens, so it has no idea this particular request is about to error or time out. **Tail sampling** buffers all spans of a trace in memory until the trace completes, then applies policies to the *finished* trace — keep if it errored, keep if it was slow, sample the rest. It is **smart** (it can guarantee "keep all the interesting traces") but expensive: it costs RAM proportional to in-flight traffic and requires a buffering collector. The trade-off is cost-and-simplicity (head) versus fidelity (tail).

### Q: Why is head sampling "blind," and when is that acceptable?

It's blind because the keep/drop decision is made at the trace's start, before the request executes — so the decision cannot depend on the outcome. A 1% head sample keeps ~1% of *everything*, which means it keeps ~1% of your *errors* too: you drop 99% of the exact traces you most wanted. It's acceptable when you want a **uniform, predictable cost cap** and you're willing to rely on metrics (kept at 100%) to *detect* problems while traces are just a representative sample for *understanding* typical behavior. It's also the only practical option at the very edge of a massive fleet where buffering whole traces is infeasible — you head-sample cheaply at the SDK, then tail-sample the survivors downstream.

### Q: Why does tail sampling have to buffer, and what does it require of your topology?

Tail sampling decides *after* seeing the whole trace, so the collector must **hold every in-flight trace in memory** for a decision window (typically a few seconds) until it believes the trace is complete, then evaluate policies against the assembled spans. The hard requirement this creates: **all spans of a single trace must reach the same collector instance** — otherwise no single instance sees the whole trace, and each makes a partial, wrong decision. You therefore can't freely round-robin spans across collectors; you need trace-ID-aware routing (the `loadbalancing` exporter hashing by `trace_id`), which is why large setups use a two-tier topology: stateless agents fan in to a gateway tier that's load-balanced by trace ID. Tail sampling's cost is memory and this topology constraint.

### Q: What is rate limiting in a sampling context, and why add it on top of probabilistic sampling?

A rate-limiting sampler caps the *absolute* number of traces (or spans) kept per unit time — e.g. "at most 100 traces/second" — regardless of incoming volume. You add it because pure probabilistic sampling keeps a fixed *percentage*, so a sudden 10× traffic spike (or a retry storm) produces 10× the kept volume and a 10× cost spike exactly when you can least afford it. Rate limiting turns that into a hard ceiling. The common pattern is a composite: a probabilistic floor for representativeness plus a rate limiter as a circuit breaker so one pathological burst can't blow the budget. The trade-off is that under a spike your effective sample rate drops, so you must track the *actual* rate to keep adjusted counts honest.

### Q: What is dynamic (adaptive) sampling and what problem does it solve?

Dynamic sampling varies the keep-rate per *key* — per route, per status, per customer tier — instead of one flat rate. The problem it solves is that uniform sampling either keeps too much of high-volume boring traffic or too little of low-volume interesting traffic. With dynamic sampling you keep, say, 1-in-1000 of the chatty `GET /health` calls but 1-in-1 of the rare `POST /checkout` errors, so rare-but-important keys stay well-represented while the firehose is throttled. Honeycomb's approach (and the OTel Collector's per-key policies) target a *fixed throughput* by adjusting each key's rate to its volume. The catch — and the senior-level point — is that each item must **carry its own sample rate** so downstream you can weight it correctly; mixing rates without per-item weights corrupts every derived count.

### Q: When do you use head, tail, and both together?

Use **head** alone when you want a simple, cheap, uniform cap and your fleet is too large or distributed to buffer traces — and you rely on always-on metrics to detect issues. Use **tail** when fidelity matters most: you must never lose an error or slow trace, and you have the collector capacity to buffer. Use **both** — the mature default — when you want a cheap raw cap *and* useful survivors: a low head sample at the SDK throttles raw volume before it hits the network, then tail sampling in the gateway ensures the traces that survive are the interesting ones (errors, slow, plus a representative baseline). Head caps the firehose; tail curates what's left.

---

## Cardinality & Cost Drivers

### Q: Walk me through the `user_id` label explosion, with numbers.

Cardinality is a **product**, not a sum. Take a latency histogram with ~12 buckets plus `_sum` and `_count` — call it 14 series — labelled `method` (4 values) × `status` (6) × `endpoint` (20):

```text
series = 14 × 4 × 6 × 20 = 6,720 time series          ← completely fine
```

Now a teammate adds `user_id` "to see per-user error rates," for 500,000 users:

```text
series = 6,720 × 500,000 = 3,360,000,000 time series  ← 3.36 BILLION. TSDB dead.
```

The label call was one free line of code; the *cardinality* it created is the bill. Because a TSDB's cost is driven by series count (it keeps an inverted index and active series in RAM), the server's memory climbs over hours or days and then OOMs and crash-loops on WAL replay — and because the whole fleet usually shares that backend, **every** team goes blind, including the one debugging the incident that prompted the label. The fix is identity → category: drop `user_id` from the metric and put it where it's cheap — a trace attribute or log field.

### Q: How do allow-lists control cardinality, and where do you apply them?

An allow-list flips the default from "keep every label/value that arrives" to "keep only the labels (and sometimes the *values*) I've explicitly approved, bucket everything else into `other`." You apply it at the collection seam — OTel Collector `attributes`/`transform`/`filter` processors, or Prometheus `metric_relabel_configs` — so a runaway label is stripped *before* it reaches storage. The most important case is **externally-sourced values**: a `route` label fed by raw request paths has no ceiling you control (a scanner hitting `/aaaa`, `/bbbb`, … invents a new value per request), so you map unmatched paths to `route="unmatched"` and cap cardinality at the source. Allow-listing values, not just label names, is what defends against adversary- or accident-driven explosions.

### Q: Dropping a label vs aggregating it away — when do you do which?

**Drop** when the dimension is genuinely useless for any query — a request ID, a raw exception string. **Aggregate-then-drop** when the *summed* value matters but the per-value breakdown doesn't: you want total request rate, not per-user rate, so you sum across the offending label (a recording rule) and then drop the raw high-cardinality series. The mistake is dropping a label some query silently depends on — strip `status` to save cardinality and your error-*rate* alert goes blind, because `http_requests_total` summed without `status` can't distinguish a 2xx from a 5xx. So the rule is: know what dashboards and alerts read a label *before* you drop it; aggregate when the rollup preserves the answer, drop only when nothing needs the dimension.

### Q: How do you move identity out of metrics into traces and logs — and why is that the right fix?

You keep the metric **low-cardinality** (aggregate error rate by bounded labels like `tier`, `route`, `status_class`) and put the *identity* where high cardinality is cheap: `user_id` as a **trace attribute** (where it's just a tag on a span) or a **log field**. Then when you need "per-user error rate," you pivot to traces/logs filtered by `user_id`. This is right because the question "is the fleet healthy?" needs bounded, always-on, aggregatable metrics, while "what did this one user experience?" is a per-case question — exactly what traces and logs are *for*. The same `user_id` that's a billion-series bomb as a metric label is a free, valuable attribute on a span. Cost control here is often just **moving** data to where it's cheap, not deleting it.

### Q: What are exemplars, and how do they relate to cost?

An exemplar is a cheap pointer attached to a metric — a single example observation carrying a `trace_id` and timestamp, typically pinned to a histogram bucket. It's the bridge from cheap aggregate metrics back to an expensive concrete trace: when p99 latency spikes, you don't keep traces for every request to explain it — you click the bucket and land on *one* representative slow trace via its exemplar. The cost relevance is direct: exemplars let you sample traces aggressively (saving 99% of trace cost) while *still* being able to jump from "this metric spiked" to "here's an actual example," because you stored a one-trace pointer instead of a high-cardinality label or a full trace per request. They give you "show me an example" without paying trace prices for everything.

### Q: Why is cardinality "exponential," and why does that make it dangerous?

Because it multiplies across labels rather than adding. Each label looks innocent in isolation — `region` (4 values) here, `tier` (3) there — but the series count is the *product* of all value-sets, so two engineers each adding "one harmless label" doesn't add their contributions, it multiplies them. The danger is that the explosion is invisible until it's already happened: the series count is fine, fine, fine, and then one more label (especially an identity one) pushes it past the millions where the TSDB OOMs — and by the time the bill or the database alerts you, the bomb already detonated. The only defense is to treat *every new label as a cardinality decision made on purpose*, with a guardrail (a series-count alert, a CI lint banning identity-shaped names) that trips before the outage instead of after.

---

## Statistical Correctness of Sampling

### Q: After sampling, how do you make a count mean what it says?

You multiply by the inverse of the sample rate — the **adjusted count** (a.k.a. upsampling). If you kept 1% of traces and counted 1,200 "checkout" traces, the real count is `1,200 × (1 / 0.01) = 120,000`. Sampling kept the data but threw away the *scale*, so every count, rate, total, or sum derived from sampled data must be scaled back by `1/sample_rate` to reflect reality. Forgetting this is one of the most common sampling bugs — the dashboard confidently shows "1,200 requests" when 120,000 happened, and someone makes a capacity decision on a number that's off by 100×. This is exactly the discipline that originated in Google's Dapper, where each sampled trace is weighted by its inverse sampling probability.

### Q: How do you stay honest when different items were sampled at different rates?

You **carry the per-item sample rate with each item** and weight each one by its own `1/rate` when aggregating — never assume one global rate. The moment you use dynamic sampling, rate limiting, or different rates per route/tier, a single global multiplier is wrong: a kept trace from a 1-in-1000 route represents 1000 real traces, while a kept trace from a 1-in-1 error policy represents exactly 1. If you count both as "one trace × global rate" you over- or under-count both. So each span/trace records the rate at which it was kept (OpenTelemetry propagates this; Honeycomb calls it `SampleRate`), and aggregation sums the *weights*, not the raw kept items. Without per-item rates, mixed-rate sampling silently corrupts every derived number.

### Q: Why does averaging a metric derived from sampled data go wrong?

Two distinct failures. First, if the metric is a **count or rate**, an average (or sum) over un-weighted sampled items ignores that each kept item stands for many dropped ones — you must weight by `1/rate` first, or the answer is scaled wrong, and *differently* wrong per key under mixed rates. Second, and subtler, sampling adds **sampling error**: a metric estimated from a sample is an estimate with variance, so averaging a few sampled observations gives you a noisy estimate of the true mean, and rare events may not appear in the sample at all — a 1% sample of a 1-in-10,000 error rate will frequently contain *zero* errors, making the estimated error rate 0 when it isn't. The fix is to derive volume-sensitive numbers (rates, error rates, totals) from **always-on, unsampled metrics**, and use sampled traces for *understanding* individual cases, not for *measuring* fleet aggregates.

### Q: How does variance behave as you sample harder?

Variance of your estimate grows as the sample shrinks — roughly, the relative error of a count scales like `1/√(kept events)`, so halving the sample rate keeps ~half as many events and widens your confidence interval by ~√2. For rare events this is brutal: at a 0.1% sample rate, an event occurring 1-in-1000 times has an *expected* kept count near zero, so your estimate swings wildly between 0 and a few. The practical consequence is that aggressive head sampling makes sampled-derived counts unreliable precisely for the rare events you care about — which is the statistical argument for keeping rare/important traffic at a higher rate (dynamic sampling) and for never *measuring* SLOs or error rates from sampled traces. Sample harder and you save money but buy noise; spend the noise budget on the boring traffic, not the rare signal.

### Q: Numeric — you keep 5% of traces (head) and see 3,000 kept "payment" traces and 18 kept errors in an hour. What are the true totals, and what's the catch on the error number?

Adjusted total payments ≈ `3,000 × (1 / 0.05) = 60,000`. Adjusted errors ≈ `18 × 20 = 360`, giving an estimated error rate of `360 / 60,000 = 0.6%`. The catch is that **18 kept errors is a tiny sample**, so that 360 is a noisy estimate — its relative error is roughly `1/√18 ≈ 24%`, i.e. the true error count could plausibly be anywhere from ~270 to ~450. You should *not* trust the sampled error count as your SLO number; the error rate must come from an **always-on, unsampled counter** (`payment_errors_total / payments_total`), with the sampled traces used only to *explain* the errors, not to *count* them. This is the fidelity-floor rule and the variance rule meeting in one number.

---

## Consistent Sampling Across Services

### Q: Why must the same `trace_id` produce the same sampling decision everywhere?

Because a trace is distributed across services, and if each service decides independently, service A may keep its half of a trace while service B drops its half — leaving you with a **broken, half-empty trace** that's worse than no trace, because it looks complete but is missing the spans where the problem actually lived. Consistent sampling means the keep/drop decision is a deterministic function of the `trace_id`, so every service that touches a given trace makes the *identical* decision: either all of it is kept or all of it is dropped. This is what lets independent head samplers across a fleet still produce *whole* traces without any coordination — the shared `trace_id` is the coordination.

### Q: How does hash-threshold (deterministic) sampling implement that?

You hash the `trace_id` to a value in a fixed range (say `[0, 1)` or a large integer space) and keep the trace iff that value falls below the sample-rate threshold — `keep = hash(trace_id) < sample_rate`. Because the hash is deterministic and the `trace_id` is shared, every service computes the *same* hash and thus the *same* decision, with zero communication. This is exactly OpenTelemetry's `TraceIdRatioBased` sampler: it derives the keep/drop directly from the trace ID, so a 10% rate keeps a consistent, reproducible 10% of *whole* traces across the entire fleet. The threshold approach also composes: as long as everyone uses the same hash function and the rates are nested, a downstream service sampling at a lower rate keeps a strict subset of what an upstream one kept.

### Q: How do ParentBased and TraceIdRatioBased fit together in OpenTelemetry?

`TraceIdRatioBased` is the *root* decision — for a brand-new trace with no parent, it deterministically keeps a fixed ratio based on the trace ID. `ParentBased` is a wrapper that says "if there's an incoming parent decision, **honor it**; only fall back to the root sampler when I'm the start of the trace." The standard production config is `ParentBased(root = TraceIdRatioBased(rate))`: the first service makes the ratio decision and stamps it into the propagated context, and every downstream service simply respects the parent's `sampled` flag. This guarantees consistency by construction — the decision is made once at the root and inherited everywhere — which is why it's the OTel SDK default and the right answer when an interviewer asks how to avoid half-sampled traces.

### Q: How is the sampling decision propagated between services?

Via the **trace context**, specifically the W3C `traceparent` header's `sampled` flag (the trace-flags bit) and, for richer per-vendor state, the `tracestate` header. When service A decides to keep a trace, it sets the sampled flag in the `traceparent` it sends downstream; service B reads that flag and — under `ParentBased` — honors it, so the whole trace is consistently kept or dropped. `tracestate` carries vendor-specific sampling metadata, including, crucially, the **sample rate or weight** so that downstream and the backend can compute correct adjusted counts (OpenTelemetry's probability-sampling spec encodes the threshold here). The headers are the wire-level mechanism that turns "consistent decision" from a wish into something that actually survives a service hop.

### Q: What exactly goes wrong with a half-sampled trace, concretely?

You get a trace that's structurally incomplete in a way that's hard to detect and easy to misread. Say the frontend keeps the trace but the payment service (deciding independently) drops its spans: you open the trace expecting to see why checkout was slow, and the payment span — where the 1.8s actually went — simply isn't there, so you conclude the frontend was slow or chase a phantom. Worse, the gaps aren't labeled "missing"; they look like the service was never called. And because the spans were dropped *inconsistently*, your trace store fills with partial traces that waste storage while answering nothing. The fix is always the same: make the decision a deterministic function of `trace_id` (or propagate the parent's decision) so a trace is atomic — wholly kept or wholly dropped.

---

## The OTel Collector

### Q: Which Collector processors do what, for cost control?

The cost toolkit, roughly in pipeline order:

- **`memory_limiter`** — sheds load (refuses data) before the collector OOMs; goes *first* so it protects everything downstream, especially critical when tail sampling buffers traces.
- **`probabilistic_sampler`** — head-style, stateless percentage sampling of traces; a cheap raw cap, deterministic on `trace_id` for consistency.
- **`tail_sampling`** — buffers whole traces and applies policies (`status_code: ERROR` → keep, `latency > threshold` → keep, `probabilistic` → sample the rest); the fidelity tool, costs memory.
- **`filter`** — drops whole spans/metrics/logs matching a condition (e.g. health-check spans, a noisy metric).
- **`attributes`** / **`transform`** — add, edit, hash, or **delete** attributes; this is where you strip a high-cardinality label like `user_id` from metrics or redact PII.
- **`batch`** — groups telemetry before export for network/throughput efficiency; effectively always present, placed last before the exporter.

The mental model: `memory_limiter` protects, samplers and `filter` reduce *count*, `attributes` reduces *cardinality/width*, `batch` makes export efficient.

### Q: Agent vs gateway — what's the difference and why have both?

An **agent** is a collector running close to the workload (a sidecar or per-node daemon) that receives local telemetry, does cheap stateless work (batching, a head sample, attribute scrubbing), and forwards on. A **gateway** is a centralized collector tier that does the expensive, *stateful* work — chiefly tail sampling, which needs to see whole traces. You have both because the cheap work should happen near the source to reduce egress and offload the app, while the work that requires a global view of each trace must happen where spans converge. The two-tier shape — many agents fanning into a load-balanced gateway pool — is the canonical production topology, and it exists specifically because tail sampling can't be done correctly at a stateless edge.

### Q: What does the load-balancing exporter (by trace ID) solve?

It solves the topology constraint that **tail sampling requires all spans of a trace to land on the same collector instance.** If agents round-robin spans across a gateway pool, each gateway sees a random subset of every trace and makes a wrong partial decision. The `loadbalancing` exporter hashes each span's `trace_id` to a specific downstream gateway, so all spans sharing a `trace_id` deterministically route to the *same* gateway, which can then assemble and tail-sample the complete trace. It's the piece that makes a horizontally-scaled tail-sampling tier possible — without it, you'd be limited to a single tail-sampling instance (a bottleneck and a single point of failure).

### Q: Why does tail sampling constrain your collector topology in general?

Because tail sampling is inherently *stateful per trace* — it can't decide until it has buffered every span of a given trace and the decision window has elapsed. That single requirement cascades into topology rules: (1) spans of one trace must converge on one decision-making instance (hence trace-ID-aware routing); (2) that instance needs RAM proportional to `in-flight traces × spans × decision_wait`, so it must be sized and protected with `memory_limiter`; (3) you can't freely autoscale the tail tier on raw load without rehashing trace routing, since moving a trace mid-flight splits it; and (4) the tail tier becomes a centralized, stateful chokepoint that needs its own HA story. Head sampling has none of these constraints (it's stateless and per-span), which is the deeper reason "use both" exists — push the stateless cap to the edge, pay the topology cost only for the fidelity layer.

---

## Tricky / Trap Questions

### Q: "Our tracing bill is huge — let's just lower the sample rate to 0.1% to fix it." What do you say?

Wrong instinct: "lower rate = lower bill = problem solved." It does lower the bill, but with **plain head sampling you now keep only 0.1% of your error traces too** — so you've cut the bill by throwing away 99.9% of the exact traces you'll need during an incident. The bill is fixed; your ability to debug is destroyed. The right move is to decouple the two goals: keep a low head rate *for the cost cap*, and add **tail sampling** that keeps 100% of errors and slow traces while sampling normal traffic at 0.1%. You get the small bill *and* the useful data, because errors are a tiny fraction of volume.

### Q: "Can we shorten log retention from 90 to 30 days to cut our metrics bill?"

Wrong instinct: "less retained data = lower bill, any bill." Log retention is a **logs-volume** lever; your metrics bill is driven by **cardinality**. They are separate budgets with separate leaks. Shortening log retention lowers your *logs* bill and does *nothing* for metrics — you'll do the work, take the loss of log history, and watch the metrics line item not move. This is the canonical "fix the wrong bill" trap: always identify *which signal* and *which driver* spiked before pulling a lever. The metrics fix is finding and dropping the high-cardinality label, not touching logs at all.

### Q: "Each instance reports its p99 from sampled traces — let's average them for the fleet p99." What's wrong?

Two independent errors stacked. First, you **can't average percentiles** at all — a percentile is a property of a distribution, and the mean of two p99s corresponds to no real request; the correct path is to aggregate the raw distributions (sum histogram buckets) *then* take the quantile. Second, computing latency percentiles from **sampled traces** is the wrong data source entirely — latency distributions should come from always-on histograms (which are constant-cost and unsampled), not from a 1% trace sample that may miss the tail. So the answer "average the sampled p99s" is wrong twice: wrong aggregation *and* wrong source. Compute fleet p99 from `histogram_quantile` over summed, unsampled histogram buckets.

### Q: "Let's add a `user_id` label to the error metric so we can see per-user error rates." Good idea?

The goal is reasonable; the mechanism is a cardinality bomb — one new series *per user*, multiplied across every existing label combination, easily billions of series, OOM-ing the shared TSDB and blinding the whole fleet. Per-user analysis is a *per-case* question, which belongs in **traces or logs** where `user_id` is a cheap attribute, not in metrics where it's a series-count product. Keep the metric low-cardinality (aggregate error rate, maybe broken down by bounded `tier`), and pivot to traces/logs filtered by `user_id` when you need the per-user view. Identity → category in the metric; identity → attribute in the trace.

### Q: "The dashboard says 1,200 requests — that's our traffic, right?" (You sample at 1%.)

No — that's the **kept** count, not the real traffic. At a 1% sample rate, true traffic ≈ `1,200 × (1 / 0.01) = 120,000`. Any count, rate, or total derived from sampled data must be multiplied by `1/sample_rate` (the adjusted count). Reporting the raw kept number as "traffic" under-reports by 100× — and if someone sizes capacity or sets an alert threshold on it, the error propagates straight into a bad decision. The deeper trap: if the sampling was *dynamic* (mixed rates), even one global multiplier is wrong, and you must weight each item by its own carried rate.

### Q: "Tail sampling guarantees we keep every error — so we're safe." True?

Only if the tail sampler actually *sees* every error span, which has real failure modes. If a trace's spans split across collector instances (no trace-ID-aware load balancing), the instance evaluating the trace may not have the span that errored, so the "keep all errors" policy silently misses it. If the `decision_wait` is shorter than the trace's duration, the trace is decided before its (late, slow, erroring) spans arrive. If `memory_limiter` sheds load during a spike, traces — including erroring ones — get dropped before any policy runs. So "tail sampling keeps all errors" is true only with correct topology, an adequate decision window, and headroom — which is exactly why errors that *must* be counted are counted from an always-on metric, not inferred from kept traces.

---

## System / Design Scenarios

For these, an interviewer wants structured reasoning under pressure — diagnose, stop the bleed, root-cause, prevent — not a keyword list.

### Q: Your observability bill doubled overnight. Walk me through diagnosing and fixing it.

**Frame it as three budgets, then bisect.** The bill is metrics + logs + traces, each with one driver, so the first move is *which signal doubled?* — pull the per-signal spend from the vendor's usage breakdown.

1. **If metrics doubled → cardinality.** Almost always a new high-cardinality label shipped in a recent deploy. Find the culprit metric (`topk(10, count by (__name__)({__name__=~".+"}))` on a healthy replica) and the offending label, then **stop the bleed**: drop that label at the collector (`attributes` delete) or via `metric_relabel_configs` — a config push, no app deploy. Root-cause the commit, replace identity with category, move the identity to a trace attribute.
2. **If logs doubled → volume.** Usually DEBUG left on in prod or a new chatty code path. Find the spike by source/level, flip the level down at runtime, prune fat fields, and check retention.
3. **If traces doubled → volume × spans.** Either traffic grew into a 100% sample, or someone raised the sample rate / added spans. Re-cap with head sampling and confirm tail policies still keep errors/slow.

**Then prevent:** the goal is that the *next* doubling pages *you* before it pages finance — alert on series count, GB ingested, and trace throughput, with per-target ingestion limits as hard ceilings and a CI lint banning identity-shaped label names. The framing that earns the offer: "I don't have *a* telemetry bill, I have three, and I diagnose which leaked before I touch any lever."

### Q: Design a sampling strategy for a 200-service fleet at 100k rps that never loses an error.

**Goals:** cap raw trace volume, guarantee 100% of errors and slow traces, keep whole (not half-sampled) traces across 200 services, and stay statistically honest.

- **Two-tier collector topology.** Per-node **agents** do cheap stateless work (batching, attribute scrubbing, a head cap); a load-balanced **gateway** tier does tail sampling. Agents use the `loadbalancing` exporter hashing by `trace_id` so all spans of a trace reach one gateway — the non-negotiable prerequisite for tail sampling working at all.
- **Consistent head cap at the SDK.** `ParentBased(TraceIdRatioBased(rate))` so the decision is deterministic on `trace_id` and propagated via `traceparent` — every service makes the same decision, no half-sampled traces. This caps the firehose before it hits the network.
- **Tail policies at the gateway.** `status_code: ERROR` → keep 100%; `latency > SLO` → keep 100%; everything else → low probabilistic sample (dynamic by route so rare routes stay represented). Size the gateway RAM for `in-flight traces × spans × decision_wait` and protect it with `memory_limiter`.
- **The fidelity floor lives in metrics, not traces.** "Never lose an error" for *detection and counting* is guaranteed by an always-on, unsampled error counter — traces *explain* errors, the metric *counts* them. This way a tail-sampler hiccup can never corrupt the SLO number.

**Numbers to anchor it:** at 100k rps with ~0.3% errors and ~0.5% slow, tail keeping all of those plus 1% of the rest keeps ≈ `100,000 × (0.003 + 0.005 + 0.01·0.992) ≈ 100,000 × 0.018 = ~1,800 traces/sec` — under 2% of volume, but it includes every error and every slow request. **Carry the per-item sample rate** so adjusted counts stay correct under the mixed rates.

### Q: Design retention tiers for traces, logs, and metrics under a fixed budget.

**Principle: recent data is precious and queried; old data is cheap to forget and rarely read at full resolution.** Spend the budget on a tiered ladder per signal.

- **Metrics:** keep raw high-resolution (e.g. 15s) **hot** for ~14 days for incident debugging, then **downsample** to 5-minute resolution for 13 months (capacity planning, year-over-year) — old data doesn't need per-second granularity. Recording rules pre-compute hot aggregations so you can drop the underlying high-cardinality series sooner.
- **Logs:** **hot/indexed** for ~7-14 days (the incident window), **warm** unindexed for ~30 days (searchable but slower/cheaper), **cold** object storage for the compliance period (rarely read, cheapest tier). Drop DEBUG before storage; keep ERROR/audit longer.
- **Traces:** because they're sampled already, keep the **kept** traces hot for ~7-30 days; archive a thin slice (errors, exemplar-linked) longer if you need historical regression analysis.
- **The floor overrides the budget:** audit, security, billing, and SLO data have *legally or contractually* mandated retention — those are line items the budget must fund first, not tiers you compress to save money.

The reasoning that signals seniority: you're trading **resolution and queryability over time**, not just "keep less" — you keep *everything recent* fully and let *old* data decay in fidelity, because that's where the value/cost ratio collapses.

### Q: Design a cardinality governance program.

**Goal: make every new label a deliberate, reviewed decision, with guardrails that trip before an outage, not after.**

- **Prevention in CI.** A lint that fails the build on identity-shaped label names (`user_id`, `request_id`, `email`, `path`, raw `url`) and on unbounded value sources; this catches ~80% of bombs at PR time.
- **Budgets per team/service.** A defined series-count budget so cardinality is a finite, owned resource — not an externality dumped on a shared TSDB.
- **Runtime guardrails.** Per-target ingestion limits (`sample_limit`, `label_limit`) as hard circuit breakers, plus a "cardinality tripwire" alert on `prometheus_tsdb_head_series` and `topk` per-metric series — so a leak pages the owner, not the finance team.
- **Architectural isolation.** Multi-tenant TSDB (Mimir/Cortex) with per-tenant series limits so one team's bomb can't blind the fleet — bounding the blast radius is as important as preventing the bomb.
- **Culture and review.** A lightweight "new label" review and an escape hatch: identity goes to traces/logs, with documented patterns for "I need per-entity data" that *don't* route through metrics.

**Watch for Goodhart:** if you reward teams purely on "reduce series count," they may delete *useful* labels (fidelity) to hit the number — so pair the cardinality budget with a fidelity check (can we still answer the questions that matter?), exactly the SLO/Goodhart tension covered in [Engineering Metrics & DORA](../../quality-engineering/engineering-metrics-and-dora/).

---

## Behavioral / Experience

### Q: Tell me about a time you cut telemetry cost.

The interviewer wants arc, numbers, and a lever matched to a driver — not "we turned off some logs." Example skeleton:

- **Symptom.** Datadog bill hit ~$45k/month, larger than the cluster it monitored; finance escalated.
- **Diagnosis.** Broke it into three budgets; the metrics line was 60% of spend, and `topk` by series showed one metric with a `customer_id` label (added "temporarily" months earlier) holding 90% of all series.
- **Fix.** Dropped the label at the collector (config push, instant), moved `customer_id` to a trace attribute, and added a `tier` label for the breakdown the team actually used. Then capped trace cost with head sampling at the SDK plus tail policies keeping errors/slow.
- **Result.** ~55% bill reduction, *no* loss of debugging ability, and a CI lint so the bomb couldn't recur.
- **Lesson.** Cost cutting is a diagnosis problem (which budget? which driver?), not a "delete data" problem.

Tell *one* story, with the before/after number.

### Q: Tell me about a time sampling bit you.

Pick a story where the *absence* of data during an incident was the cost. Strong elements: the data you wished you had (e.g. the error trace was head-sampled away at 1%, so the one occurrence you needed simply didn't exist), the moment you realized "we sampled it out," and the structural fix (switched to tail sampling with a `status_code: ERROR` keep-all policy, so errors are now never lost). Bonus if you mention a *second* class of bite — discovering a dashboard count was the raw kept number, off by 100× because nobody applied `1/sample_rate`, and how you fixed both the number and the team's mental model. The lesson the interviewer is listening for: sampling is a lie you tell on purpose, and the discipline is keeping the floor at 100% and the math honest.

### Q: How would you convince a team to adopt a telemetry budget?

Lead with *their* incentive, not policy. The pitch: "Right now telemetry cost is an invisible externality — anyone can ship a label that bills the whole org and blinds the fleet, and the first signal is the invoice or an outage. A budget makes it a finite, owned resource you control, with a guardrail that pages *you* early instead of pages finance late." Make adoption cheap: a CI lint and a thin instrumentation library that bakes in the right defaults (bounded labels, base units), so doing the right thing is the *path of least resistance*, not extra work. Show one concrete near-miss (a `topk` query revealing a metric one deploy away from OOM) to make the risk visceral. And explicitly guard against Goodhart — frame it as "spend the budget where it buys answers," not "minimize the number," so nobody games it by deleting fidelity. Consistency is enforced, not requested, but it's enforced by making the easy path the correct one.

---

## What I'd Ask a Candidate Now

The interviewer's-eye view — what separates junior, senior, and staff answers on this topic.

### Q: Head vs tail sampling — when would you use each?

**Junior** correctly defines both. **Senior** explains the trade — head is cheap/stateless/blind, tail is smart/expensive — *and* names the topology constraint (tail needs whole traces co-located) and the "use both" pattern. **Staff** goes further: head's statelessness is *why* it's pushed to the edge, tail's per-trace state is *why* it forces a gateway tier, load-balancing by `trace_id`, and `memory_limiter` sizing — they reason from the property (stateful vs stateless) to the architecture, and mention that error *counting* should come from metrics so a tail hiccup can't corrupt the SLO.

### Q: How do you keep numbers honest after sampling?

The single best discriminator. **Junior** may not know counts need adjusting at all. **Senior** states `multiply by 1/sample_rate` and that mixed rates need per-item rates carried with each item. **Staff** adds the variance argument — sampled counts have error scaling like `1/√(kept events)`, rare events may be entirely absent from a 1% sample, so volume-sensitive numbers (rates, error rates, SLOs) must come from always-on unsampled metrics, with sampled traces used only to *explain* cases, never to *measure* aggregates. A candidate who says "we just report the kept count" reveals the gap immediately.

### Q: How do you avoid broken half-sampled traces across services?

**Junior** may not realize independent decisions break traces. **Senior** says "make the decision deterministic on `trace_id`" and names `ParentBased(TraceIdRatioBased)` and propagation via the `sampled` flag. **Staff** connects all of it: hash-threshold so nested rates keep strict subsets, `tracestate` carrying the sample rate for downstream adjusted counts, and the gateway/`loadbalancing`-exporter topology that makes consistent *tail* sampling possible at scale — they see consistency as a property that must hold at both the SDK and the collector tiers.

### Q: Your telemetry bill doubled — diagnose it.

Listening for the **three-budgets framing**: a strong candidate immediately asks "which signal?" and maps signal → driver (metrics→cardinality, logs→volume, traces→volume×spans) before touching a lever, then stops the bleed at the collector (config, not deploy) and adds a guardrail so the next one pages early. The wrong hire pulls a random lever ("shorten log retention") without identifying the driver, or proposes "buy more capacity."

### Q: A PM wants per-user metrics — what do you do?

Reveals whether they understand the metrics/traces boundary. Strong answer: keep the metric low-cardinality (aggregate, maybe by `tier`), put `user_id` where it's cheap (trace attribute / log field / warehouse), and pivot there for per-entity questions — "metrics answer *is the fleet healthy*, per-entity is a different system with different economics." The wrong answer adds the label "temporarily."

---

## Cheat Sheet

Top-10 must-know questions for any telemetry-cost-and-sampling interview:

```
┌──────────────────────────────────────────────────────────────────────────┐
│ MUST-KNOW TELEMETRY-COST & SAMPLING QUESTIONS                            │
├──────────────────────────────────────────────────────────────────────────┤
│  1. The three cost drivers?                                             │
│       → METRICS=cardinality, LOGS=volume, TRACES=volume×spans.          │
│         Match the lever to the driver; don't fix the wrong bill.        │
│                                                                          │
│  2. Head vs tail sampling?                                              │
│       → HEAD: decide at start, cheap/stateless/BLIND (drops errors).    │
│         TAIL: buffer whole trace, decide at end, SMART (keeps errors).  │
│         Use BOTH: head caps volume, tail curates survivors.             │
│                                                                          │
│  3. What is the fidelity floor?                                         │
│       → errors · audit/security · SLO · billing. NEVER sample. 100%.    │
│                                                                          │
│  4. Adjusted count?                                                     │
│       → multiply sampled count by 1/sample_rate. 1% kept → ×100.        │
│         Mixed rates → carry per-item rate, weight by its own 1/rate.    │
│                                                                          │
│  5. Why not measure rates/SLOs from sampled traces?                     │
│       → variance ~1/√(kept events); a 1% sample of a rare error often   │
│         contains ZERO. Count from always-on UNSAMPLED metrics.          │
│                                                                          │
│  6. Consistent sampling across services?                               │
│       → same trace_id → SAME decision, or you get half-empty traces.    │
│         hash(trace_id)<rate; ParentBased(TraceIdRatioBased); propagate  │
│         via traceparent sampled flag + tracestate.                      │
│                                                                          │
│  7. Why does tail sampling need whole traces co-located?               │
│       → it decides after seeing all spans → loadbalancing exporter by   │
│         trace_id → agent→gateway topology. Constrains your collector.   │
│                                                                          │
│  8. The cardinality bomb?                                              │
│       → series = PRODUCT of label values. user_id label → billions →   │
│         TSDB OOM → whole fleet blind. Identity → trace/log, not metric. │
│                                                                          │
│  9. Where do you control cost?                                         │
│       → the OTel COLLECTOR (config push, not deploy). memory_limiter,   │
│         probabilistic_sampler, tail_sampling, filter, attributes,batch. │
│                                                                          │
│ 10. Bill doubled — first move?                                          │
│       → WHICH signal? → WHICH driver? → stop bleed at collector →       │
│         root-cause → add guardrail that pages YOU before finance.       │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Further Reading

- **Honeycomb — "Sampling" guide & dynamic sampling** — the clearest plain-English head-vs-tail, per-item sample rates, and throughput-targeting explainer: <https://docs.honeycomb.io/manage-data-volume/sampling/>.
- **OpenTelemetry — Sampling concepts** (head, tail, `TraceIdRatioBased`, `ParentBased`, probability propagation) — <https://opentelemetry.io/docs/concepts/sampling/>.
- **OpenTelemetry Collector — `tail_sampling`, `probabilistic_sampler`, `loadbalancing` exporter, `memory_limiter`** — the processors/exporters you'll actually configure.
- **Google — "Dapper" paper** — the origin of trace sampling and inverse-probability adjusted counts: <https://research.google/pubs/pub36356/>.
- **Prometheus — "Cardinality is key"** and `prometheus_tsdb_head_series` — diagnosing and budgeting the metrics driver.
- **W3C Trace Context** — `traceparent` sampled flag and `tracestate` — the wire mechanism for consistent decisions and rate propagation: <https://www.w3.org/TR/trace-context/>.
- **"Observability Engineering" — Majors, Fong-Jones, Miranda** — the definitive cardinality, cost-of-fidelity, and sampling-correctness chapters.
- **Google SRE Workbook — "Alerting on SLOs"** — why volume-sensitive SLO signals must be unsampled and always-on.

---

## Related Topics

- [Telemetry Cost & Sampling — Junior](junior.md)
- [Telemetry Cost & Sampling — Middle](middle.md)
- [Telemetry Cost & Sampling — Senior](senior.md)
- [Telemetry Cost & Sampling — Professional](professional.md)
- [Telemetry Cost & Sampling — Tasks](tasks.md)

**Sibling diagnostic topics:**

- [Metrics](../metrics/) — the cardinality cost driver originates here; histograms and the "can't average p99s" rule.
- [Tracing](../tracing/) — the signal you sample most; spans, `trace_id`, context propagation.
- [Logging](../logging/) — the volume cost driver; levels, retention, field pruning.
- [Observability Engineering](../observability-engineering/) — the whole-system strategy this cost discipline serves.
- [Continuous Profiling](../continuous-profiling/) — another signal with its own sampling/cost story.

**Cross-roadmap links:**

- [Quality Engineering → Engineering Metrics & DORA](../../quality-engineering/engineering-metrics-and-dora/) — Goodhart's law and SLOs: why "reduce telemetry cost" is a metric you can game by deleting fidelity, and why SLO signals must stay unsampled.
