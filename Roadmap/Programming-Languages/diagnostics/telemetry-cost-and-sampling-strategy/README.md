# Telemetry Cost & Sampling Strategy Roadmap

> *"If your observability bill is bigger than the bill for the system it observes, you have stopped measuring the system and started measuring your budget."*

This roadmap is about **controlling the volume and cost of logs, metrics, and traces while preserving the fidelity you actually need.** It is the discipline that keeps observability from quietly becoming the most expensive line item you own — and from failing at the only moment it has to work: the 3 a.m. question, when the one trace you needed was the one you sampled away.

> Looking for *what* to emit (the four metric types, span design, structured logs)? See the sibling pillars: [Metrics](../metrics/), [Tracing](../tracing/), [Logging](../logging/).
>
> Looking for the *strategy* of observability as a whole (what to instrument, SLOs, the build-vs-buy of a stack)? See [Observability Engineering](../observability-engineering/).
>
> This section is the **economics-and-throughput** discipline — how much of what you emit you actually keep, where you decide that, and how you stay statistically honest after throwing data away.

---

## Why a Dedicated Roadmap

"Log everything, trace everything, measure everything" is the default, and it is financially and operationally unsustainable the moment traffic and service count grow. Telemetry volume grows *super-linearly*: more traffic × more services × more spans-per-request × more labels-per-metric. A senior engineer knows the cost driver is different for each signal, and that the cure differs accordingly.

| Signal | Dominant cost driver | The killer pattern | The lever |
|---|---|---|---|
| **Metrics** | **Cardinality** (one time series per unique label set) | a `user_id` label → one series per user | label allow-lists; move identity to exemplars/traces |
| **Logs** | **Volume** (bytes ingested × retention) | DEBUG logs left on in prod at full traffic | level control, field pruning, retention tiers |
| **Traces** | **Volume × span count** | 100% sampling of a 40-span request at 50k rps | head + tail sampling in the collector |

The central choice this roadmap turns on is **head vs tail sampling** for traces:

| | **Head-based** | **Tail-based** |
|---|---|---|
| **Decides** | at trace *start*, before anything happened | after the *whole* trace is seen |
| **Knows if the trace is interesting?** | No — it's blind | Yes — saw the error / the latency |
| **Cost / complexity** | Cheap, stateless, per-service | Expensive — collector must buffer every trace |
| **Keeps all errors & slow traces?** | No (only by luck) | Yes (that's the whole point) |
| **Good for** | uniform cost cap, huge fleets | "keep the ones that matter" |

---

## Sections

| # | Topic | Focus |
|---|---|---|
| 01 | The Cost Problem | Super-linear growth; observability bill > compute bill; cost vs fidelity vs 3 a.m. questions |
| 02 | Cost Drivers per Signal | Cardinality (metrics), volume (logs), volume × spans (traces), wide events |
| 03 | Cardinality, the Metric Killer | The `user_id` explosion, worked numbers, allow-lists, dropping labels |
| 04 | Head-Based Sampling | Probabilistic, rate-limiting; cheap, stateless, blind to interestingness |
| 05 | Tail-Based Sampling | Buffer-then-decide; keep all errors + slow traces + a sample of the rest |
| 06 | Consistent / Deterministic Sampling | Same `trace_id` decision across services; propagating the decision; OTel samplers |
| 07 | Statistical Correctness | Adjusted counts / upsampling (×1/sample_rate) so sampled metrics stay accurate |
| 08 | Reducing Cost Without Losing Signal | Aggregation at source, exemplars, log levels, field pruning, span filtering |
| 09 | Retention & Downsampling Tiers | Hot/warm/cold, recording rules, Prometheus downsampling, metric rollups |
| 10 | The OTel Collector as Control Point | `tail_sampling`, `probabilistic_sampler`, `filter`, `attributes`, `memory_limiter`; gateway vs agent |
| 11 | The Fidelity Floor | What you keep at 100% — errors, audit/security, SLO signals, billing — and never sample |
| 12 | Org Cost Strategy | Budgets, chargeback/showback, cardinality governance, policy-as-code, spend anomaly alerts, vendor pricing traps |

---

## Languages

Configuration-first (the cost-control point is the **OpenTelemetry Collector**, language-agnostic YAML), with SDK-side sampler examples in **Go**, **Java**, **Python**, **Node**, and **Rust** for head sampling and propagating the sampling decision.

---

## Tools

The **OpenTelemetry Collector** (`probabilistic_sampler`, `tail_sampling`, `filter`, `attributes`, `batch`, `memory_limiter` processors), **Prometheus** (recording rules, downsampling), **Grafana Mimir / Thanos / VictoriaMetrics** (retention tiers, rollups), and vendor backends (Honeycomb, Datadog, Grafana Cloud) whose pricing models drive the trade-offs. The `observability-stack`, `monitoring-alerting`, and `caching-strategies` skills are directly relevant.

---

## Status

✅ **Content complete** — `junior` · `middle` · `senior` · `professional` · `interview` · `tasks`.

---

## References

- *Observability Engineering* — Majors, Fong-Jones, Miranda (cardinality, wide events, the cost argument)
- **Honeycomb — Sampling docs & "Dynamic Sampling"** (the canonical head-vs-tail and dynamic-sampling treatment)
- **OpenTelemetry — Sampling & the Collector `tail_sampling`/`probabilistic_sampler` processors**
- **Google — "Dapper, a Large-Scale Distributed Systems Tracing Infrastructure"** (the origin of trace sampling and adjusted counts)
- **Prometheus — Recording rules & downsampling**; Grafana Mimir / Thanos compactor docs

---

## Project Context

Part of the [Senior Project](../../../../index.md) — a personal effort to consolidate the essential knowledge of software engineering in one place.
