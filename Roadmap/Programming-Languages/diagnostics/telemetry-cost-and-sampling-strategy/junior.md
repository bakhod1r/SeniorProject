# Telemetry Cost & Sampling Strategy — Junior Level

> **Topic:** [Telemetry Cost & Sampling Strategy Roadmap](README.md)
> **Focus:** Why telemetry costs money, where the money goes for each of the three signals, and the one idea that controls trace cost — sampling. Head vs tail in plain terms. The one rule you must never break: don't sample away your errors.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Cost Drivers per Signal](#cost-drivers-per-signal)
6. [Real-World Analogies](#real-world-analogies)
7. [Mental Models](#mental-models)
8. [Head vs Tail Sampling](#head-vs-tail-sampling)
9. [Your First Sampling Config — Examples](#your-first-sampling-config--examples)
10. [What Telemetry Costs](#what-telemetry-costs)
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

> Focus: **Why does observability cost money at all?** and **What is the cheapest first move to stop a telemetry bill from running away?**

Every log line you write, every metric series you create, and every trace you record has to be **shipped, stored, and indexed** somewhere — and you pay for all three. On a toy service this is free in practice. On a real one, the bill grows faster than your traffic does, because telemetry volume is *multiplicative*: more requests × more services × more spans per request × more fields per event. Plenty of teams reach the point where their **observability bill is larger than the compute bill for the system being observed.** That is the problem this roadmap exists to solve.

The instinct of a new engineer — *"log everything, trace everything, measure everything, so we never miss anything"* — is exactly the instinct that produces that bill. It is not wrong because detail is bad; it is wrong because **keeping 100% of everything forever is unaffordable, and most of it is never looked at.** The discipline is to keep the data that lets you answer real questions and drop the data that doesn't, *without* dropping the one trace you'll need at 3 a.m.

The single most important tool for this is **sampling**: deliberately keeping only *some* of your telemetry — most often, some of your traces. This page covers why each signal costs what it costs (metrics → cardinality, logs → volume, traces → volume), and the one decision at the heart of trace cost: **head sampling** (decide up front, cheap but blind) vs **tail sampling** (decide after seeing the whole trace, expensive but keeps the interesting ones). The next level ([`middle.md`](middle.md)) shows you real collector configs and the cardinality trap up close. [`senior.md`](senior.md) covers staying statistically honest after you've thrown data away.

> 🎓 **Why this matters for a junior:** The first time a service ships to real traffic, someone eventually asks "why is our Datadog/Honeycomb/Grafana bill $40k/month?" The answer is almost always *uncontrolled telemetry*. Knowing the three cost drivers — and that sampling is a deliberate, configurable choice, not a default — is how you avoid being the person who shipped the `user_id` metric label that melted the bill.

---

## Prerequisites

What you should know before reading this:

- **Required:** You've emitted at least one metric, written structured logs, or seen a trace. If not, read [Metrics — Junior](../metrics/junior.md), [Logging](../logging/), and [Tracing](../tracing/) first — this page is about the *cost* of those things.
- **Required:** A rough sense that a server costs money per CPU/GB, and that a SaaS tool charges per some unit (per GB, per host, per million events).
- **Helpful:** You've seen a YAML config file. The OpenTelemetry Collector is configured in YAML and most examples here are YAML.
- **Helpful:** Basic probability — "1% sample" means "keep 1 in 100." Nothing beyond that for this tier.
- **Helpful:** You know what a `trace_id` is — a single ID shared by all the spans of one request as it crosses services. ([Tracing](../tracing/).)

---

## Glossary

| Term | Definition |
|------|-----------|
| **Telemetry** | The umbrella term for the signals a system emits about itself: logs, metrics, traces (the "three pillars"). |
| **Sampling** | Deliberately keeping only a *fraction* of telemetry (usually traces) instead of all of it, to control cost. |
| **Sample rate** | The fraction kept. "1% sampling" = `sample_rate = 0.01` = keep 1 in 100. |
| **Head-based sampling** | Decide whether to keep a trace at its **start**, before you know what happened. Cheap, stateless, blind. |
| **Tail-based sampling** | Buffer the whole trace, then decide at the **end**, having seen errors/latency. Expensive, smart. |
| **Cardinality** | The number of distinct label/tag combinations on a metric. The cost driver for metrics. |
| **Volume** | Total bytes (or events) ingested and stored. The cost driver for logs. |
| **Span** | One timed operation within a trace (e.g. "the DB call"). A trace is a tree of spans. Traces cost ≈ volume × spans-per-trace. |
| **Retention** | How long you keep data before deleting it. Longer retention = more storage = more cost. |
| **Ingest** | The act of sending telemetry into a backend; usually the metered, billed step. |
| **OTel Collector** | The OpenTelemetry Collector — a standalone process that receives, processes, samples, and exports telemetry. The central place to enforce cost control. |
| **Exemplar** | A cheap pointer attached to a metric that links to one example trace — a bridge from cheap metrics to expensive traces. (See [`middle.md`](middle.md).) |
| **Fidelity** | How completely your telemetry lets you answer questions. The thing sampling trades away — carefully. |
| **The fidelity floor** | The signals you must keep at 100% no matter what: errors, audit/security events, SLO-relevant data, billing. |
| **Adjusted count / upsampling** | Multiplying a count derived from sampled data by `1/sample_rate` so the number still reflects reality. (See [`senior.md`](senior.md).) |

---

## Core Concepts

### 1. Telemetry costs money to ship, store, and index — and the bill scales with volume, not value

You pay three times for one log line: to **transmit** it (network), to **store** it (disk, for the whole retention window), and often to **index** it (so you can search it fast). None of those costs care whether the line was ever useful. A vendor charges you the same for the DEBUG line nobody read as for the ERROR that explained an outage. That asymmetry — cost scales with *volume*, value does not — is the whole reason sampling and filtering exist.

### 2. The three signals fail expensive in three different ways

There is no single "telemetry cost" lever. **Metrics** explode through **cardinality** — every new label combination is a new time series to store forever. **Logs** explode through **volume** — bytes × retention. **Traces** explode through **volume × spans** — a single request can be 40 spans, and at high traffic that is a firehose. Knowing *which* driver is hurting tells you *which* lever to pull. Pulling the wrong one (e.g. shortening log retention to fix a metrics-cardinality bill) does nothing.

### 3. Sampling is keeping *some* and being honest about it

Sampling means: of all the traces (or logs) flowing through, keep a chosen fraction and drop the rest. The art is choosing *which* fraction. Keeping a random 1% is cheap but blind — you'll drop most of your errors too. Keeping *all errors plus a sample of normal traffic* costs more to compute but keeps the data you actually use. The honest part comes later: if you kept 1% and you want to report "total requests," you must multiply by 100 (see [`senior.md`](senior.md)).

### 4. Head sampling is blind; tail sampling can see

The deepest distinction in this whole topic: do you decide to keep a trace **before** it happens (head) or **after** (tail)? Head sampling is a coin-flip at the start — cheap, but the coin doesn't know the request is about to fail. Tail sampling waits, buffers all the spans, *looks* at the finished trace, and then keeps it if it's an error or slow. Tail sampling is the only way to guarantee "keep all the interesting traces," and it costs real memory and a collector to buffer.

### 5. Some signals you never sample

There is a floor below which you do not cut, no matter the bill: **errors, security/audit events, SLO-relevant signals, and billing data.** Sampling away an audit log can be illegal. Sampling away the error trace defeats the purpose of having traces. Sampling away an SLO signal corrupts the number your whole reliability program runs on. Cost control is about cutting the *boring high-volume* data, not the rare important data — those are opposites.

---

## Cost Drivers per Signal

The most important table in this roadmap. Memorise the middle column.

| Signal | Cost driver | The killer pattern | What it costs | The fix |
|---|---|---|---|---|
| **Metrics** | **Cardinality** — distinct label sets | a high-cardinality label (`user_id`, `request_id`, full URL, email) | one time series *per unique value* — millions of series | drop/allow-list labels; move identity to logs/traces/exemplars |
| **Logs** | **Volume** — bytes × retention | DEBUG on in prod; fat JSON fields; everything kept 90 days | ingest + storage scale with traffic, linearly and relentlessly | level control, field pruning, retention tiers |
| **Traces** | **Volume × spans/trace** | 100% sampling of deep traces at high rps | every request × every span, shipped and stored | head + tail sampling |

A worked number for the metrics killer (the one juniors hit first):

```text
metric:   http_request_duration_seconds  (a histogram, ~12 buckets + _sum + _count ≈ 14 series)
labels:   method (4 values) × status (6 values) × endpoint (20 values)
series:   14 × 4 × 6 × 20 = 6,720 time series           ← totally fine

Now someone adds  user_id  as a label, for 500,000 users:
series:   6,720 × 500,000 = 3,360,000,000 time series   ← 3.36 BILLION. Database dead.
```

The label call was free. The *cardinality* it created is the bill. (Full treatment with the collector fix in [`middle.md`](middle.md).)

---

## Real-World Analogies

| Concept | Real-World Analogy |
|---|---|
| **Telemetry cost** | A storage unit you rent by the box. Every box costs rent every month whether you ever open it again. |
| **Sampling** | A factory's quality control inspecting 1 in 100 widgets instead of all of them — cheaper, still informative, *if* you pick well. |
| **Head sampling** | Flipping a coin at the *door* to decide whether to photograph a guest — before you know if they're the one who'll cause trouble. |
| **Tail sampling** | A security camera that records everyone into a short buffer, then *keeps* the clip only if something happened — and erases the boring ones. |
| **Cardinality** | Filing every customer's receipt under a *separate* tab labelled with their name. A thousand customers, a thousand tabs; a million, a filing-cabinet warehouse. |
| **Volume (logs)** | A diary where you write down literally everything, every second. The notebook (and the cost of warehousing decades of them) is the problem, not any one entry. |
| **The fidelity floor** | The legal documents you must keep by law no matter how full the cabinet gets — you shred the junk mail, never the contracts. |
| **Exemplar** | A sticky note on a summary chart that says "for a real example of this spike, see camera footage clip #4471." |
| **Retention tiers** | Recent files on your desk (fast, expensive), last year's in a cabinet (slower, cheaper), the archive in cold storage offsite (slowest, cheapest). |

---

## Mental Models

### 1. Cost scales with what you *keep*, not what you *emit*

Your code can emit a million spans a second; if the collector keeps 1%, you store ten thousand. The lever is almost never "emit less in the code" (that loses information *and* couples cost control to deploys); it's "**keep less, centrally**, in the collector." Decouple "what the app produces" from "what the backend bills you for." That seam is the OTel Collector.

### 2. The three signals are three separate budgets with three separate leaks

Don't think "the telemetry bill." Think three bills. When one spikes, ask *which signal* and *which driver*. A metrics spike is almost always a new high-cardinality label someone shipped. A logs spike is almost always a log level left on or a new chatty code path. A traces spike is almost always traffic growth meeting 100% sampling. Different leak, different wrench.

### 3. Sampling trades fidelity for cost — and the trade is only good if you cut the boring data

A 1% random sample of traces saves 99% of trace cost and loses 99% of your *errors* too — a bad trade. Tail-sampling "all errors + 1% of the rest" saves nearly as much cost but keeps the data you actually open. **Good sampling is not "less data"; it's "the same useful data, less noise."** If your sampling drops things you later wish you had, you sampled wrong, not too much.

### 4. The 3 a.m. test

Before you enable any drop or sample, ask: *"If the worst incident happened tonight, would this data have been the thing I needed?"* If yes, it's on the fidelity floor — keep it at 100%. If you genuinely wouldn't have looked at it, it's a candidate to cut. This single question separates safe cost-cutting from the kind that bites you during an outage.

### 5. Cardinality is exponential; you will not notice until it's too late

Cardinality multiplies across labels. Each label looks innocent on its own. Two engineers each add "one harmless label" and the series count doesn't add — it *multiplies*. By the time the bill or the database alerts you, the explosion already happened. The only defense is to treat *every new label* as a cardinality decision, made on purpose.

---

## Head vs Tail Sampling

This is the heart of the topic. A concrete scenario makes the difference unforgettable.

> **Scenario.** Your checkout service handles **50,000 requests/second**, each producing a trace of ~30 spans. Keeping 100% is unaffordable. 0.3% of requests **error**; another 0.5% are **slow** (>2s). You want to keep your trace bill small *and* never lose an error or a slow request.

**Head-based sampling (probabilistic, 1%).** At the *start* of each trace, flip a weighted coin: keep with probability 0.01. Cheap, stateless, every service can do it independently. But the coin is flipped *before the request runs* — it has no idea this particular request is about to error or time out. Result: you keep ~1% of *everything*, which means you keep ~1% of your errors too — you **drop 99% of the exact traces you wanted.** Good for a flat cost cap; useless for "keep the interesting ones."

**Tail-based sampling.** The collector **buffers all spans of each trace** in memory until the trace completes, then applies policies to the *finished* trace:

```text
  policy 1: status == ERROR        → KEEP 100%   (saw the error)
  policy 2: duration > 2s          → KEEP 100%   (saw it was slow)
  policy 3: everything else        → KEEP 1%     (a representative sample)
```

Now you keep **every error, every slow request, and a 1% sample of normal traffic** — the cost of roughly 1.8% of traces instead of 1%, but you never lose the trace you'll actually open. The price: the collector must **hold every trace in memory** until it's complete (typically a few seconds' decision window) and must see *all* spans of a trace — which constrains your collector topology (a single trace's spans must reach the same collector instance).

| | **Head-based** | **Tail-based** |
|---|---|---|
| **When decided** | trace start | after trace completes |
| **Sees if interesting?** | No | Yes |
| **Memory cost** | ~zero | buffers every in-flight trace |
| **Needs all spans co-located?** | No | **Yes** (collector must see the whole trace) |
| **Keeps all errors?** | only ~sample_rate of them | **yes, 100%** |
| **Best for** | uniform cap, massive fleets, simplicity | keeping the traces that matter |

Most mature setups use **both**: a cheap head sample at the SDK to cap raw volume, then tail sampling in the collector to make sure the survivors are the *useful* ones. (Real config in [`middle.md`](middle.md); consistent decisions across services in [`senior.md`](senior.md).)

---

## Your First Sampling Config — Examples

The cost-control point is the **OpenTelemetry Collector**, configured in YAML. Here are the two starter processors.

### Probabilistic (head-style) sampling in the Collector

```yaml
# otel-collector-config.yaml
processors:
  # Keep ~10% of traces, blind to whether they're interesting. Cheap and stateless.
  probabilistic_sampler:
    sampling_percentage: 10        # 10% kept; the simplest cost cap there is

  batch: {}                        # always batch before export (efficiency)

service:
  pipelines:
    traces:
      receivers:  [otlp]
      processors: [probabilistic_sampler, batch]
      exporters:  [otlp]
```

### Tail sampling — keep all errors and all slow traces, sample the rest

```yaml
processors:
  tail_sampling:
    decision_wait: 10s             # buffer each trace up to 10s before deciding
    num_traces: 100000             # max traces held in memory at once
    policies:
      - name: keep-all-errors
        type: status_code
        status_code: { status_codes: [ERROR] }   # 100% of error traces
      - name: keep-slow-traces
        type: latency
        latency: { threshold_ms: 2000 }           # 100% of traces over 2s
      - name: sample-the-rest
        type: probabilistic
        probabilistic: { sampling_percentage: 1 } # 1% of everything else

service:
  pipelines:
    traces:
      receivers:  [otlp]
      processors: [tail_sampling, batch]
      exporters:  [otlp]
```

That config is the entire "scenario" above made real: errors and slow traces kept at 100%, normal traffic at 1%. (Adding `memory_limiter`, `filter`, and `attributes` processors — the rest of the cost toolkit — is in [`middle.md`](middle.md).)

### Dropping a high-cardinality metric label at the source

```yaml
processors:
  # Strip the cardinality-bomb label before it ever reaches the metrics backend.
  attributes/drop-userid:
    actions:
      - key: user_id
        action: delete            # remove user_id from every metric data point

service:
  pipelines:
    metrics:
      receivers:  [otlp]
      processors: [attributes/drop-userid, batch]
      exporters:  [prometheusremotewrite]
```

The same `user_id` is fine — even valuable — as a *trace attribute* or *log field*, where cardinality is cheap. Cost control is often just **moving** data to where it's cheap, not deleting it.

---

## What Telemetry Costs

| Thing | What you pay for | Scales with |
|---|---|---|
| One metric **time series** | storage of every point, forever in retention | **cardinality** (label combinations) |
| One **log line** | transmit + store (× retention) + often index | **volume** (bytes × retention) |
| One **trace** | transmit + store every span | **volume × spans per trace** |
| A **scrape / ingest** | the metered, billed event in most SaaS pricing | number of series / GB / events |
| **Retention** | storage for the whole window | days kept × volume |
| **Indexing** | fast search over logs/traces | bytes indexed |

The headline: **emitting is cheap; keeping is the bill.** A counter you increment a billion times is one series. A log line you write a billion times is a billion lines you store. The difference is *aggregation* — and the cheapest cost lever of all is to aggregate at the source and keep the summary, not the raw stream. (See [`middle.md`](middle.md).)

---

## Use Cases

| Situation | What to reach for |
|---|---|
| Trace bill growing with traffic | Head sampling for a cap, then tail sampling for fidelity |
| "We dropped the error trace we needed" | Tail sampling with a `status_code: ERROR` keep-all policy |
| Metrics bill exploded after a deploy | Find the new high-cardinality label; drop/allow-list it in the collector |
| Logs bill is the biggest line item | Turn off DEBUG in prod; prune fat fields; tier retention |
| Need the example trace behind a metric spike | **Exemplars** (cheap metric → one trace pointer) |
| Old data is cheap to forget, recent is precious | Retention tiers (hot/warm/cold) + downsampling |
| Audit / billing / SLO data | **Never sample** — fidelity floor, keep 100% |

---

## Best Practices

1. **Never sample away errors, audit/security events, SLO signals, or billing.** This is the one inviolable rule. Tail-sample so these are kept at 100%.
2. **Control cost in the collector, not the code.** Keep the app emitting; decide what to keep centrally so you can change it without a deploy.
3. **Treat every new metric label as a cardinality decision.** If you can't list its possible values on a whiteboard, it's probably a bomb. Identity (user/request IDs, emails, URLs) goes in logs/traces, never metric labels.
4. **Use both head and tail sampling** — head for a raw cost cap, tail to make sure the survivors are the useful ones.
5. **Turn DEBUG off in prod by default** and make log level changeable at runtime, not only at deploy.
6. **Tier your retention.** You rarely need 90 days of full-resolution data; keep recent data hot and downsample older data.
7. **Alert on telemetry spend / cardinality**, not just on the system. A new high-cardinality label should page *you* before it pages your finance team.

---

## Edge Cases & Pitfalls

- **Random sampling drops your errors.** A flat 1% head sample keeps ~1% of errors too. If errors matter (they do), you need tail sampling, not just a lower head rate.
- **Counting from sampled data without adjusting.** If you keep 1% and report the raw kept count as "total requests," you're under-reporting by 100×. Multiply by `1/sample_rate`. (See [`senior.md`](senior.md).)
- **Tail sampling with split traces.** If a trace's spans land on *different* collector instances, none of them sees the whole trace and the tail decision is wrong. Spans of one trace must reach the same collector. (Topology: [`middle.md`](middle.md).)
- **Dropping a label you derive alerts from.** Strip `status` to save cardinality and your error-rate alert goes blind. Know what queries depend on a label before you drop it.
- **DEBUG logging left on in prod.** The single most common logs-cost blowout. One config flag, enormous bill.
- **Sampling configured per-service inconsistently.** Service A keeps a trace, service B drops its half of it → broken, half-empty traces. Sampling decisions must be *consistent* across services. ([`senior.md`](senior.md).)
- **Memory blowout from tail sampling.** Buffering every in-flight trace uses RAM proportional to traffic × decision_wait. Without `memory_limiter`, the collector OOMs under load — exactly when you need it.

---

## Common Mistakes

1. **"Log/trace/measure everything" as a default.** The instinct that produces the runaway bill. Decide what to keep on purpose.
2. **Putting identity (`user_id`, `request_id`, email, full URL) in a metric label.** The #1 cardinality explosion. It belongs in a log or trace attribute.
3. **Using random head sampling and being surprised errors vanished.** Random sampling is blind; it can't preserve rare-but-important traces.
4. **Reporting metrics derived from sampled traces without multiplying by `1/sample_rate`.** Silently wrong numbers.
5. **Fixing the wrong bill** — shortening log retention to cut a metrics-cardinality cost. Match the lever to the driver.
6. **Cutting cost by dropping the signals you actually need** (Goodhart: gaming "reduce telemetry spend" by deleting fidelity). Cross-ref [Engineering Metrics & DORA](../../quality-engineering/engineering-metrics-and-dora/).
7. **Sampling in the application code**, hard-coded, so changing it needs a deploy. Do it in the collector.
8. **No alerting on telemetry cost**, so the first signal is the invoice.

---

## Tricky Points

1. **Head sampling can be cheap *and* consistent — but never *smart*.** It can guarantee the same decision across services (via the `trace_id`), which is great; it can never know whether the trace is interesting, which is its ceiling.
2. **Tail sampling needs the whole trace, which constrains topology.** You can't freely load-balance spans across collectors; a trace's spans must converge on one decision-maker. This is why large setups use a two-tier collector (agent → gateway).
3. **Dropping a label is not always free of meaning.** `http_requests_total` summed without the `status` label can't tell you the error *rate* anymore. Cardinality reduction can quietly destroy a query.
4. **Sampling rate and statistical correctness are linked.** Every count, rate, or percentage you derive from sampled traces must be scaled by `1/sample_rate` to mean what it says. (Worked maths: [`senior.md`](senior.md).)
5. **Exemplars are the cheap bridge.** Instead of keeping expensive traces to explain a metric spike, attach one *exemplar* (a trace pointer) to the cheap metric. You get "show me an example" without paying trace prices for every request.
6. **"Keep everything" can be cheaper than bad sampling if the data is tiny** — don't reflexively sample low-volume, high-value signals. Sampling is for *high-volume* data.

---

## Test Yourself

1. Name the dominant cost driver for each of metrics, logs, and traces. For each, name one thing that triggers an explosion.
2. A histogram has 14 series and labels `method`(4) × `status`(6) × `endpoint`(20). How many series? Now someone adds `user_id` for 100k users — how many?
3. Explain head vs tail sampling to a teammate in two sentences. Which one can guarantee you keep all error traces?
4. You keep 2% of traces (head). You count 4,000 kept "checkout" traces in an hour. Roughly how many checkouts actually happened?
5. Why must the spans of a single trace reach the *same* collector instance for tail sampling to work?
6. List four signals you must never sample, and say why for each.
7. Your metrics bill tripled after a deploy. What's the first thing you look for?
8. Write the three tail-sampling policies (in words) that keep all errors, all slow traces, and 1% of the rest.

---

## Tricky Questions

**Q1: We just turned on tracing and our bill is huge. Should we lower the sample rate to 0.1%?**

You *can*, but if you use plain head sampling you'll also keep only 0.1% of your error traces — which defeats the point of having traces. Better: keep a low head rate *for cost*, and add **tail sampling** that keeps 100% of errors and slow traces. You get the small bill and the useful data.

**Q2: A teammate wants to add `user_id` as a metric label "so we can see per-user error rates." Good idea?**

The goal is good; the mechanism is a cardinality bomb — one time series per user, potentially millions. Per-user analysis belongs in **logs or traces** (where `user_id` is a cheap attribute), not metrics. Keep the metric low-cardinality (aggregate error rate) and pivot to traces/logs filtered by `user_id` when you need the per-user view.

**Q3: We sampled 1% of traces. The dashboard says "1,200 requests." Is that the real traffic?**

No — that's the *kept* count. Real traffic ≈ 1,200 × (1 / 0.01) = **120,000**. Any count, rate, or total derived from sampled data must be multiplied by `1/sample_rate` (the "adjusted count"). Forgetting this is one of the most common sampling bugs. (Detail: [`senior.md`](senior.md).)

**Q4: Can we just shorten log retention from 90 to 30 days to cut our metrics bill?**

No. Log retention is a *logs-volume* lever; your metrics bill is driven by *cardinality*. They're separate budgets with separate leaks. Shortening log retention will lower your *logs* bill and do nothing for metrics. Match the lever to the driver.

**Q5: Why not just sample in the application, with a config flag, instead of running a collector?**

You can head-sample in the SDK, and it's worth doing for a cheap cap. But *tail* sampling (keep the interesting ones) needs to see the whole finished trace, which the app can't — only a buffering collector can. And changing an app-side rate needs a deploy; changing the collector is a config push. The collector is the right control point.

**Q6: Our collector keeps running out of memory under load. Why?**

If you're tail-sampling, the collector buffers every in-flight trace for `decision_wait` seconds — RAM scales with traffic. Add a `memory_limiter` processor (it sheds load before OOM), cap `num_traces`, and consider a shorter `decision_wait`. Tail sampling is not free; it trades memory for fidelity.

---

## Cheat Sheet

```text
┌────────────────── TELEMETRY COST & SAMPLING — JUNIOR CHEAT SHEET ──────────────────┐
│                                                                                     │
│  WHY IT COSTS                                                                       │
│    You pay to SHIP + STORE (×retention) + INDEX every signal. Cost ∝ volume,       │
│    not value. The default "log/trace/measure everything" is the runaway bill.      │
│                                                                                     │
│  THE THREE DRIVERS  (memorise)                                                      │
│    METRICS → CARDINALITY  (one series per label combo; user_id label = death)      │
│    LOGS    → VOLUME       (bytes × retention; DEBUG-in-prod is the classic leak)   │
│    TRACES  → VOLUME × SPANS (high rps × deep traces = firehose → SAMPLE)           │
│                                                                                     │
│  HEAD vs TAIL SAMPLING                                                              │
│    HEAD  decide at trace START. cheap, stateless, BLIND. drops errors too.          │
│    TAIL  buffer whole trace, decide at END. expensive, SMART. keeps the good ones.  │
│    USE BOTH: head for a cap, tail to keep errors + slow + 1% of the rest.           │
│                                                                                     │
│  THE FIDELITY FLOOR  (NEVER SAMPLE)                                                 │
│    errors · audit/security · SLO signals · billing.  Keep these at 100%.            │
│                                                                                     │
│  STATISTICAL HONESTY                                                                │
│    count from sampled data → multiply by 1/sample_rate. (1% kept → ×100)            │
│                                                                                     │
│  WHERE TO CONTROL COST                                                              │
│    the OTel COLLECTOR (YAML), not the app code. change by config, not deploy.       │
│    processors: probabilistic_sampler · tail_sampling · attributes(drop label)      │
│                                                                                     │
│  GOLDEN RULES                                                                       │
│    • cut the boring high-volume data, never the rare important data.                │
│    • every new metric label is a cardinality decision. identity → logs/traces.      │
│    • match the lever to the driver. alert on spend, not just on the system.         │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Summary

- **Telemetry costs money** to ship, store, and index — and the cost scales with *volume*, not with how useful the data is. "Log/trace/measure everything" is the instinct that produces a bill bigger than the system it observes.
- The **three signals fail expensive three different ways**: metrics → **cardinality**, logs → **volume**, traces → **volume × spans**. Match the cure to the driver.
- **Sampling** keeps a deliberate fraction of telemetry (usually traces) to control cost. The trade is only good when you cut *boring* data and keep *important* data.
- **Head sampling** decides at the trace's start — cheap, stateless, but blind to whether the trace is interesting (so it drops most of your errors). **Tail sampling** buffers the whole trace and decides at the end — expensive (memory + a buffering collector), but keeps all errors and slow traces.
- Most real setups use **both**: head for a cost cap, tail to keep the survivors useful.
- The **fidelity floor** — errors, audit/security, SLO signals, billing — is **never** sampled.
- After sampling, **stay statistically honest**: multiply counts by `1/sample_rate`.
- Control cost in the **OTel Collector** (config, not code): `probabilistic_sampler`, `tail_sampling`, and `attributes`/`filter` to drop high-cardinality labels (moving identity to logs/traces, where it's cheap).

---

## What You Can Build

- A **"three drivers" drill**: a list of 20 telemetry items (a `user_id` metric label, a DEBUG log, a 40-span trace at 50k rps…) and a quiz that asks "which driver, which fix?"
- A **local collector sandbox**: run the OTel Collector with the `tail_sampling` config above, fire synthetic traces (some errored, some slow), and confirm with your eyes that errors and slow traces survive while normal ones are sampled to 1%.
- A **cardinality calculator**: a tiny script that takes a metric's labels and their value-counts and prints the resulting series count — then re-run it after "adding `user_id`" to feel the explosion.
- An **adjusted-count exercise**: generate 100k synthetic requests, head-sample 1%, then write the code that reconstructs the true total via `1/sample_rate` and check it against the real number.
- A **"what would I have needed?" audit** of a service's telemetry: for each signal, label "fidelity floor (keep 100%)" or "boring high-volume (safe to sample)."

---

## Further Reading

- **Honeycomb — "Sampling" guide** — the clearest plain-English head-vs-tail and dynamic-sampling explainer: <https://docs.honeycomb.io/manage-data-volume/sampling/>.
- **OpenTelemetry — Sampling concepts** — <https://opentelemetry.io/docs/concepts/sampling/>.
- **OpenTelemetry Collector — `tail_sampling` & `probabilistic_sampler` processors** — the configs you'll actually write.
- **Google — "Dapper" paper** — where trace sampling and adjusted counts came from: <https://research.google/pubs/pub36356/>.
- *Observability Engineering* (Majors, Fong-Jones, Miranda) — the cardinality and cost-of-fidelity chapters.

---

## Related Topics

- **Next level up:** [middle.md](middle.md) — real collector configs, the cardinality trap up close, exemplars, retention tiers, gateway vs agent topology.
- **Senior level:** [senior.md](senior.md) — consistent sampling across services, statistical correctness / adjusted counts, the fidelity floor in depth.
- **Professional level:** [professional.md](professional.md) — org cost strategy, budgets & chargeback, cardinality governance, vendor pricing traps, Goodhart risk.
- **Interview prep:** [interview.md](interview.md).
- **Practice:** [tasks.md](tasks.md).

**Sibling diagnostic topics:**

- [Metrics](../metrics/) — the cardinality cost driver originates here.
- [Tracing](../tracing/) — the signal you sample most; spans, `trace_id`, propagation.
- [Logging](../logging/) — the volume cost driver; levels and field pruning.
- [Observability Engineering](../observability-engineering/) — the whole-system strategy this cost discipline serves.
- [Continuous Profiling](../continuous-profiling/) — another signal with its own sampling/cost story.

**Cross-roadmap links:**

- [Quality Engineering → Engineering Metrics & DORA](../../quality-engineering/engineering-metrics-and-dora/) — Goodhart's law and SLOs: why "reduce telemetry cost" is a metric you can game by deleting fidelity.

---

## Diagrams & Visual Aids

### The three cost drivers

```text
   ┌──────────────────────────── ONE SYSTEM, THREE BILLS ───────────────────────────┐
   │                                                                                 │
   METRICS  │  cost ∝ CARDINALITY      one series per label-combo. user_id → boom.   │
   │                                                                                 │
   LOGS     │  cost ∝ VOLUME           bytes × retention. DEBUG-in-prod → boom.       │
   │                                                                                 │
   TRACES   │  cost ∝ VOLUME × SPANS   rps × spans/trace. 100% at scale → boom. SAMPLE.│
   └─────────────────────────────────────────────────────────────────────────────────┘
   Different leak per signal → different lever. Don't fix the wrong bill.
```

### Head vs tail sampling

```text
   HEAD (decide at start, BLIND)            TAIL (buffer, decide at end, SMART)
   request ──► [coin flip 1%] ──► keep?     request ──► [buffer all spans]
                  │                                          │
            knows NOTHING about               sees: ERROR? SLOW?
            the request yet                              │
                  │                          ┌───────────┼────────────┐
            drops 99% of                  error→KEEP  slow→KEEP   normal→1%
            errors too                       100%       100%       sample
   cheap, stateless                         needs memory + whole trace at one collector
```

### Where to control cost — the collector seam

```text
   APP (emit freely) ──OTLP──► [ OTel COLLECTOR ] ──► BACKEND (you pay here)
                                    │
              ┌─────────────────────┼──────────────────────────┐
              ▼                     ▼                           ▼
       probabilistic_sampler   tail_sampling            attributes / filter
       (cap raw volume)        (keep errors+slow)       (drop user_id label,
                                                         move identity to traces)
   Change cost by CONFIG PUSH, not by redeploying the app.
```

---
