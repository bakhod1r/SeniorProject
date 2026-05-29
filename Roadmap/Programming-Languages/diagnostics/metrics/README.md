# Metrics Roadmap

> *"What you can't measure, you can't improve — but what you measure badly, you'll optimise for the wrong thing."*

This roadmap is about **emitting numeric signals from a running program** — counters, gauges, histograms, and the discipline of choosing what to measure. It's the second of the "three pillars of observability" alongside [Logging](../logging/) and [Tracing](../tracing/).

> Looking for *system-level* observability (Prometheus stack, Grafana, alert design)? See [Backend → Observability](../../../Backend/backend/09-observability/02-metrics/).
>
> Looking for *profiling* (CPU / memory / lock contention)? See [Quality Engineering → Performance → Profiling](../../quality-engineering/performance/01-profiling/).
>
> This section is the **language-level** discipline — what your code emits, not what your monitoring stack ingests.

---

## Why a Dedicated Roadmap

Every team's first metric is "request count" — and most stop there. A senior engineer knows:

- **Counters** can only go up — wrong tool for "current connections"
- **Histograms** are eight bytes per observation when stored as percentiles, lossless when stored as buckets — choose deliberately
- **High-cardinality labels** (user ID, request ID) destroy your TSDB — but the same data as a *log* or *trace attribute* is fine
- The metric you wish you had at 3 a.m. is the one you didn't think mattered at design time

| Roadmap | Question it answers |
|---|---|
| [Logging](../logging/README.md) | What happened, in human-readable form? |
| [Tracing](../tracing/README.md) | What's the path of one request through the system? |
| **Metrics** (this) | What's the aggregate behaviour over time? |

---

## Sections

| # | Topic | Focus |
|---|---|---|
| 01 | What Counts as a Metric | Numeric, time-series, aggregatable; metric vs log vs trace |
| 02 | Counter, Gauge, Histogram, Summary | The four base types, what each is for, what they cost |
| 03 | Labels & Cardinality | Why user-ID labels kill your TSDB; high vs low cardinality dimensions |
| 04 | Naming & Units | `_seconds`, `_bytes`, `_total`; Prometheus conventions; OpenMetrics |
| 05 | Pull vs Push | Prometheus scrape vs StatsD push; trade-offs and failure modes |
| 06 | The Four Golden Signals | Latency, traffic, errors, saturation (Google SRE book) |
| 07 | RED & USE | Request-rate / Error-rate / Duration; Utilisation / Saturation / Errors |
| 08 | Percentiles & Histograms | p50/p95/p99, why averages lie, HDR histograms, bucket sizing |
| 09 | OpenTelemetry Metrics SDK | Cross-language standard; instruments, views, exporters |
| 10 | Language-Specific Clients | `prometheus_client` (Python), Micrometer (JVM), `prometheus/client_golang` (Go), `metrics` (Rust) |
| 11 | Cost & Sampling | Metric cardinality explosions, sampling strategies, dropping vs aggregating at source |
| 12 | Anti-patterns | "Just emit everything," metric-driven design, gauge-as-counter, untyped strings |

---

## Languages

Examples in **Go** (`prometheus/client_golang`, `expvar`), **Java** (Micrometer, JFR-as-metrics), **Python** (`prometheus_client`, OpenTelemetry SDK), **Rust** (`metrics`, `prometheus`), and **Node** (`prom-client`, OpenTelemetry).

---

## Status

⏳ **Structure defined; content pending.**

---

## References

- *Site Reliability Engineering* — Google SRE Book (Four Golden Signals chapter)
- *Observability Engineering* — Majors, Fong-Jones, Miranda (the cardinality argument)
- *Histograms with Prometheus: A Tale of Woe* — Björn Rabenstein
- *USE Method* — Brendan Gregg

---

## Project Context

Part of the [Senior Project](../../../../index.md) — a personal effort to consolidate the essential knowledge of software engineering in one place.
