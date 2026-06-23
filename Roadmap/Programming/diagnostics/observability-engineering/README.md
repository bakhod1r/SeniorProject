# Observability Engineering Roadmap

> *"Monitoring tells you whether the system is working. Observability lets you ask why it isn't — including for failures you never imagined."*

This roadmap is the **umbrella discipline** of the diagnostics section. It sits *above* [Logging](../logging/), [Metrics](../metrics/), [Tracing](../tracing/), and [Continuous Profiling](../continuous-profiling/) and asks the synthesis question they each answer in part: **can you understand your system's internal state from its outputs — and answer questions you did not anticipate when you wrote the code?**

The other roadmaps teach you to *emit* one kind of signal. This one teaches you to *unify* them into a single capability: forming a hypothesis at 3 a.m., querying your telemetry, narrowing to the one affected customer, and confirming the fix — without shipping new instrumentation first.

---

## Why a Dedicated Roadmap

Most teams *monitor*. Far fewer are *observable*. The difference is not a tooling upgrade; it is a change in what questions you are able to ask.

**Monitoring** watches *known* failure modes: you predict what can break, build a dashboard and an alert for each, and get paged when a threshold trips. It is the discipline of **known-unknowns** — "is CPU high? is the error rate up?" **Observability** is the property of being able to ask **arbitrary new questions** of a system — *unknown-unknowns* — from the outside, without deploying new code. The word comes from control theory (Kálmán, 1960): a system is *observable* if its internal state can be reconstructed from its external outputs. Microservices and distributed systems forced the issue: when one user request fans out across forty services, no single dashboard can enumerate the ways it might fail.

| | **Monitoring** | **Observability** |
|---|---|---|
| Answers | Known-unknowns ("is X broken?") | Unknown-unknowns ("why is *this* broken, in a way I didn't predict?") |
| Built from | Predefined dashboards & alerts | Arbitrarily-wide structured events, queried ad hoc |
| New question costs | A code change + deploy | A new query |
| Data shape | Pre-aggregated metrics | High-cardinality, high-dimensionality events |
| Failure it handles | The outage you anticipated | The outage you didn't |
| Origin | Ops/NOC tradition | Control theory; distributed systems |

Observability *subsumes* monitoring — you still want dashboards and alerts on the signals you can predict. But the defining test of an observable system is the **3 a.m. question**: a customer reports a problem no dashboard shows, and you can still find the cause by slicing your telemetry along a dimension you never alerted on.

---

## Sections

| # | Topic | Focus |
|---|---|---|
| 01 | Observability vs Monitoring | Control-theory origin; known- vs unknown-unknowns; why distributed systems forced the shift |
| 02 | The Three Pillars (and the Critique) | Logs, metrics, traces — and why "three pillars" is an implementation detail, not the goal |
| 03 | The Arbitrarily-Wide Structured Event | The real unit of observability; one wide event per request, queried not pre-aggregated |
| 04 | High Cardinality & Dimensionality | The superpower (slice to one customer) and the cost driver (cross-ref telemetry-cost) |
| 05 | OpenTelemetry | The vendor-neutral spec, SDKs, and Collector; signals; context propagation; why OTel won |
| 06 | Correlating Signals | trace_id in logs, exemplars (metric→trace), span→profile; the single pane of glass |
| 07 | Instrumentation Strategy | Auto vs manual; span design; what to instrument; RED / USE / golden signals as a starting set |
| 08 | SLIs, SLOs & Error Budgets | The user-facing layer of observability (cross-ref engineering-metrics-and-dora) |
| 09 | The Debugging Loop | Hypothesis → query → narrow → repeat; observability-driven debugging in production |
| 10 | Sampling & Cost | Keeping the questions answerable without paying for every event (cross-ref telemetry-cost) |
| 11 | Designing an Observability Platform | Collector topology, backends, build-vs-buy, the data-model decisions that decide 3 a.m. |
| 12 | Culture & Maturity | Observability-driven development, debugging in prod, on-call, the maturity model, adoption |

---

## Languages

Examples in **Go** (`go.opentelemetry.io/otel`), **Python** (`opentelemetry-sdk`), **Java** (OpenTelemetry Java agent + Micrometer bridge), with structured-event, `trace_id`-in-log, and OpenTelemetry Collector configuration shown across tiers. The principles are language-agnostic; OpenTelemetry is the common substrate.

## Tools

OpenTelemetry SDKs + the **Collector**; **Prometheus** / **Grafana** (metrics + dashboards); **Tempo** / **Jaeger** (traces); **Loki** (logs); **Pyroscope** / Parca (profiles); and commercial backends — **Honeycomb** (the wide-event model), **Datadog**, **Grafana Cloud**, **New Relic**. See the `observability-stack` and `monitoring-alerting` skills for tooling deep-dives.

---

## Status

✅ **Content complete** — `junior` · `middle` · `senior` · `professional` · `interview` · `tasks`.

---

## References

- *Observability Engineering* — Charity Majors, Liz Fong-Jones & George Miranda (O'Reilly) — the wide-event / high-cardinality argument and the canonical definition.
- *Distributed Systems Observability* — Cindy Sridharan (O'Reilly) — the three-pillars framing and its limits.
- *Site Reliability Engineering* — Google SRE Book — SLIs/SLOs/error budgets and the Four Golden Signals.
- *The Site Reliability Workbook* — Google — implementing SLOs in practice.
- **OpenTelemetry documentation** — <https://opentelemetry.io/docs/> — the spec, SDKs, and Collector.

---

## Project Context

Part of the [Senior Project](../../../../index.md) — a personal effort to consolidate the essential knowledge of software engineering in one place.
