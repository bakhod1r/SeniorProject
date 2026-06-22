# Observability Engineering — Professional Level

> **Topic:** [Observability Engineering Roadmap](README.md)
> **Focus:** Observability as an organisational discipline and platform. The OpenTelemetry pipeline at scale — agent vs gateway Collector topology, where tail sampling lives, multi-tenancy and PII governance. Backend architecture and build-vs-buy (Prometheus/Grafana/Tempo/Loki vs Honeycomb vs Datadog). The observability maturity model and cultural adoption (observability-driven development). SLO practice across many teams, cost governance, on-call and incident response enabled by observability, and the Goodhart traps that ruin observability metrics.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [The Observability Platform — A Reference Architecture](#the-observability-platform--a-reference-architecture)
6. [Collector Topology: Agent vs Gateway](#collector-topology-agent-vs-gateway)
7. [Backends and Build-vs-Buy](#backends-and-build-vs-buy)
8. [The Observability Maturity Model](#the-observability-maturity-model)
9. [Cultural Adoption & Observability-Driven Development](#cultural-adoption--observability-driven-development)
10. [SLO Practice at Org Scale](#slo-practice-at-org-scale)
11. [Cost Governance](#cost-governance)
12. [On-Call & Incident Response](#on-call--incident-response)
13. [Goodhart Pitfalls on Observability Metrics](#goodhart-pitfalls-on-observability-metrics)
14. [Code Examples](#code-examples)
15. [Use Cases](#use-cases)
16. [Mental Models](#mental-models)
17. [Best Practices](#best-practices)
18. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
19. [Common Mistakes](#common-mistakes)
20. [Tricky Points](#tricky-points)
21. [Test Yourself](#test-yourself)
22. [Cheat Sheet](#cheat-sheet)
23. [Summary](#summary)
24. [Further Reading](#further-reading)
25. [Related Topics](#related-topics)
26. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

> Focus: **How do you make a whole organisation observable — the pipeline, the backends, the budget, and the culture — not just one well-instrumented service?**

The senior level was about designing observability into *a* service. This level is about the **platform** and the **organisation**: dozens of teams, polyglot services, millions of dollars of telemetry spend, an on-call rotation that lives or dies by whether the data answers questions at 3 a.m. The technical core is the same OpenTelemetry pipeline — but now you must decide its *topology* (agent vs gateway Collectors, where tail sampling runs, how multi-tenancy and PII redaction work), its *backends* (the build-vs-buy question that determines your cost and capability ceiling), and its *economics* (telemetry is frequently a top-three infrastructure line item — cross-ref [telemetry-cost](../telemetry-cost-and-sampling-strategy/)).

But the platform is only half the job, and the easier half. The harder half is **adoption and culture**. An observability platform that nobody instruments richly, or that engineers don't reach for during incidents, is shelfware. The professional discipline includes the **maturity model** (where is the org on the path from "we have logs" to "we debug unknown-unknowns in minutes"), **observability-driven development** (instrumentation written *with* the feature, not bolted on after an outage), **SLO practice** that scales to many teams without becoming bureaucratic theatre, and the **Goodhart traps** — the ways well-intentioned observability metrics get gamed into uselessness ("100% of services have a dashboard" while none of them answer real questions).

This page is written for the engineer who owns, or influences, observability across an organisation: platform/SRE leads, staff engineers setting standards, anyone deciding build-vs-buy or defending the telemetry budget. We connect to the `observability-stack` and `monitoring-alerting` skills for tooling and alert-design depth, and to [engineering-metrics-and-dora](../../quality-engineering/engineering-metrics-and-dora/) for the SLO and reliability-metric foundations.

> 🎓 **Why this matters at the professional level:** At this scale, the failure modes are organisational and economic, not technical. The platform that works for one team falls over at fifty; the SLO practice that's crisp for one service becomes theatre across the org; the telemetry bill that's a rounding error becomes a budget crisis. Getting observability right at the org level is a leadership problem with a technical substrate.

---

## Prerequisites

- **Required:** [`senior.md`](senior.md) — wide-event design, cardinality economics, span/data-model design, the debugging loop, SLO/alerting fundamentals, sampling and fidelity.
- **Required:** [`middle.md`](middle.md) — OTel spec/SDK/Collector, propagation, correlation chain.
- **Required:** Operating experience with a real backend (Prometheus/Grafana or a SaaS) and a Collector deployment.
- **Helpful:** [`../telemetry-cost-and-sampling-strategy/`](../telemetry-cost-and-sampling-strategy/) for the cost/sampling deep dive.
- **Helpful:** [`../../quality-engineering/engineering-metrics-and-dora/`](../../quality-engineering/engineering-metrics-and-dora/) for SLO/error-budget and reliability-metric practice, and the Goodhart discussion there.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Agent Collector** | A Collector running *next to* the workload (sidecar or per-node DaemonSet); first-hop collection. |
| **Gateway Collector** | A centralised Collector tier (a scalable deployment) that does heavy processing — tail sampling, routing, redaction. |
| **Tail sampling** | A keep-decision made after a whole trace is seen; requires all spans of a trace to land on the *same* Collector instance. |
| **Span metrics** | Metrics (RED) derived from spans by the Collector's `spanmetrics` connector — metrics without separate instrumentation. |
| **OTTL** | OpenTelemetry Transformation Language — the Collector's expression language for transforming/redacting telemetry. |
| **Build-vs-buy** | The decision between self-hosting an OSS stack and paying a SaaS vendor. |
| **Maturity model** | A staged description of an org's observability capability, from reactive monitoring to proactive observability. |
| **ODD** | Observability-Driven Development — writing instrumentation as part of the feature, validated in prod. |
| **Error budget policy** | The pre-agreed consequence of burning the budget (e.g. freeze features, prioritise reliability). |
| **Cardinality budget** | A per-team/per-service cap on label/attribute cardinality to control cost. |
| **Goodhart's Law** | "When a measure becomes a target, it ceases to be a good measure." |
| **MTTD / MTTR** | Mean Time To Detect / Mean Time To Resolve — incident-response outcome metrics. |
| **Single pane of glass** | One place to pivot across all signals; an aspiration often abused as a procurement slogan. |

---

## Core Concepts

### 1. Observability is a platform, and platforms have customers

Your customers are the engineering teams. The platform's job is to make rich instrumentation *easy* (sane defaults, shared SDK config, auto-instrumentation, golden dashboards) and the wrong thing *hard* (cardinality guardrails, PII redaction by default). Treat it as a product: paved roads, self-service, documentation, and a feedback loop — not a mandate.

### 2. The Collector tier is where org-level policy lives

In a one-service world the Collector is a convenience. At org scale it is the **policy enforcement point**: tail sampling, PII redaction, attribute normalisation, cost controls, backend routing, and multi-tenancy all live in the gateway tier — *centrally*, without redeploying every service. Owning the Collector topology is owning observability governance.

### 3. Build-vs-buy is a capability and cost decision, not just a price

Self-hosting OSS (Prometheus/Grafana/Tempo/Loki) gives control and avoids per-GB SaaS pricing, but you pay in operational toil and you inherit the TSDB cardinality ceiling. SaaS (Honeycomb, Datadog) buys you the wide-event query model or a turnkey platform, but the bill scales with telemetry volume and can become the dominant cost. There is no universally right answer — only a right answer for your scale, team, and cardinality needs.

### 4. Adoption beats architecture

A perfect pipeline feeding a perfect backend is worthless if teams emit thin spans and never query during incidents. The maturity model and ODD culture are not soft extras — they're the difference between an observability *platform* and an observability *capability*.

### 5. SLOs scale only with discipline

One service's SLO is easy. Fifty teams' SLOs become theatre unless you standardise (what's an SLI, how to set targets, the error-budget policy) without centralising (each team owns its SLOs). The goal is a *shared language*, not a central committee approving every threshold.

### 6. Cost is a first-class design constraint

Telemetry volume grows super-linearly with traffic and microservice count. Without governance — sampling, cardinality budgets, retention tiers, attribution back to teams — the bill becomes a crisis and the reflexive fix (turn down sampling) blinds you exactly when you scale. Cost governance is an observability-design problem, not just a finance one (cross-ref [telemetry-cost](../telemetry-cost-and-sampling-strategy/)).

### 7. Observability metrics get Goodharted

The moment "every service must have a dashboard" or "MTTR must drop 20%" becomes a target, teams optimise the *metric*, not the *capability*. Professional practice means choosing observability KPIs that resist gaming and watching for the gaming when it happens.

---

## The Observability Platform — A Reference Architecture

A platform is a pipeline with policy, governance, and a product surface around it.

```text
  ┌─ SERVICES (polyglot: Go, Python, Java, Node) ─┐
  │  OTel SDK / auto-instrumentation              │   instrument ONCE (vendor-neutral)
  └───────────────────────┬───────────────────────┘
                          │ OTLP
                          ▼
  ┌─ AGENT COLLECTOR (per-node DaemonSet / sidecar) ─┐
  │  receive · enrich (k8s metadata) · batch         │   first hop, near the workload
  └───────────────────────┬───────────────────────────┘
                          │ OTLP (load-balancing exporter, trace-aware)
                          ▼
  ┌─ GATEWAY COLLECTOR TIER (scaled deployment) ─────────────────────┐
  │  TAIL SAMPLING · PII redaction (OTTL) · attribute normalisation   │   ORG POLICY
  │  span→metrics connector · cost controls · multi-tenant routing    │   lives here
  └──────────┬───────────────────┬───────────────────┬───────────────┘
             ▼                    ▼                   ▼
        TRACES backend       METRICS backend      LOGS backend
        (Tempo / Honeycomb)  (Prometheus/Mimir)   (Loki)
             └─────────── single query/pivot layer (Grafana / SaaS UI) ──────────┘
                          dashboards · SLOs · alerting · ad-hoc exploration
```

Key properties this buys you:

- **Instrument once, govern centrally.** Apps speak OTLP; everything downstream — sampling, redaction, backend choice — changes in the Collector tier without app redeploys.
- **PII never leaves un-redacted.** A redaction stage in the gateway is the chokepoint where you guarantee emails/card numbers/tokens are scrubbed before export, especially to a third-party SaaS.
- **Cost lives in one place.** Sampling and cardinality controls are centralised, so you can tune the bill without touching fifty repos.
- **Backends are swappable.** Re-point an exporter; run two backends in parallel during a migration.

---

## Collector Topology: Agent vs Gateway

The single most important platform-architecture decision. The two roles are usually *both* present in a layered topology.

| | **Agent Collector** | **Gateway Collector** |
|---|---|---|
| Runs as | Sidecar or per-node DaemonSet | Centralised, horizontally-scaled deployment |
| Proximity | Next to the workload | A shared tier |
| Does | Receive, add host/k8s metadata, batch, ship | Tail sampling, redaction, normalisation, routing, span-metrics |
| Why | Offload the app, capture node context | Centralise expensive/global processing & policy |
| Scaling | One per node/pod | Scale out by load |

### The tail-sampling constraint that shapes the whole topology

Tail sampling must see **all spans of a trace** to decide whether to keep it — so all spans of a given trace must reach the **same** gateway instance. You cannot naïvely round-robin spans across gateway replicas, or each replica sees a fragment and the decision is wrong. The solution is a **trace-aware load-balancing exporter** on the agent tier that routes by `trace_id`, plus a two-layer gateway (a routing layer that shards by `trace_id`, then a sampling layer). This constraint is *the* reason gateway Collectors exist as a distinct tier and why tail sampling is a platform concern, not an app one.

```text
   agents ──(load-balancing exporter, hash by trace_id)──► gateway replica N
                                                            (sees the WHOLE trace)
                                                            → correct tail decision
```

### Where each policy lives

- **Agent:** host/k8s resource enrichment, batching, initial OTLP receive. Cheap, local, per-node.
- **Gateway:** tail sampling (needs whole traces), PII redaction (one chokepoint), attribute normalisation (consistent names org-wide), `spanmetrics` connector (RED from spans), multi-tenant routing, and exporter fan-out.

For a small org, a single gateway tier suffices. As trace volume grows, split routing from sampling. This topology is what lets a 200-service org change sampling or add a backend with zero app deploys.

---

## Backends and Build-vs-Buy

The backend determines your *capability ceiling* (can you `group by` arbitrary high-cardinality fields?) and a large fraction of your *cost*.

### The OSS / self-host stack

| Tool | Signal | Notes |
|---|---|---|
| **Prometheus** (or **Mimir/Thanos** for scale/HA) | Metrics | The TSDB standard. Cardinality is the cost/scaling ceiling — high-cardinality labels are forbidden. |
| **Grafana** | Dashboards / query layer | The pane-of-glass over Tempo/Loki/Prometheus; exemplar support links metrics→traces. |
| **Tempo** | Traces | Cheap object-store-backed tracing; pairs with tail sampling in the Collector. |
| **Loki** | Logs | Label-indexed log store; correlate via `trace_id`. |
| **Pyroscope / Parca** | Profiles | Continuous profiling; span-aware linking. |

**Strengths:** control, no per-GB vendor pricing, data stays in-house, no lock-in. **Costs:** real operational toil (you run, scale, and upgrade it), and you inherit the TSDB cardinality ceiling — slicing to one customer needs the trace/log side, not Prometheus.

### The SaaS options

| Vendor | Model | Notes |
|---|---|---|
| **Honeycomb** | Wide-event / columnar | Built around the arbitrarily-wide event; `group by` any high-cardinality field, BubbleUp outlier analysis. The native expression of the senior-level model. |
| **Datadog** | Turnkey all-in-one | Broad, polished, fast to adopt; pricing scales with hosts/volume/custom metrics and can dominate the bill. |
| **Grafana Cloud** | Managed OSS stack | Hosted Prometheus/Tempo/Loki — OSS model without the ops. |
| **New Relic / others** | All-in-one | Similar trade-offs to Datadog. |

### The decision framework

| Choose **build (OSS)** when | Choose **buy (SaaS)** when |
|---|---|
| You have platform/SRE capacity to operate it | Engineering time is scarcer than money |
| Data residency / sovereignty is mandatory | You want capability *now*, not in a quarter |
| Volume is huge and per-GB SaaS pricing is prohibitive | The wide-event query model (Honeycomb) is the goal and you won't build a column store |
| You need deep customisation | You'd rather not run a TSDB at scale |

**The pragmatic reality:** most orgs end up **hybrid** — OTel as the universal instrumentation layer (so the choice is reversible), Prometheus/Grafana for cheap, high-value SLO metrics, and a SaaS (often Honeycomb-style) for high-cardinality trace exploration. Because everything speaks OTLP through the Collector, build-vs-buy becomes a *per-signal*, *reversible* decision rather than a one-way door. **OTel is the hedge that keeps the question open.**

---

## The Observability Maturity Model

A staged view of where an org actually is. Useful for honest assessment and for sequencing investment.

| Level | Name | Characteristic | The telling question |
|---|---|---|---|
| **0** | Reactive | Logs grepped on boxes; alerts on host metrics | "What happened?" answered by SSH-ing in |
| **1** | Monitoring | Dashboards + threshold alerts for known failures | "Is X broken?" — but only X you predicted |
| **2** | Structured | Structured logs, RED metrics, some tracing; signals exist but are siloed | "We have logs, metrics, traces" (uncorrelated) |
| **3** | Correlated | Shared `trace_id` across signals; exemplars; you pivot signal→signal | "From this metric spike I can reach the trace and logs" |
| **4** | Observable | Wide events, high-cardinality ad-hoc queries; SLOs; debug unknown-unknowns with no deploy | "We cornered a novel failure in minutes by slicing on a dimension we never alerted on" |
| **5** | Proactive | Observability drives development; experiments in prod; cost-governed; observability is a paved road | "Instrumentation ships with the feature; we explore prod routinely, not just during incidents" |

Use it diagnostically, not as a vanity ladder. The jump that matters most is **2 → 3 → 4**: from "we have the signals" to "they're correlated" to "we can ask new questions." Many orgs stall at level 2 with three expensive, disconnected pipelines and call it observability.

---

## Cultural Adoption & Observability-Driven Development

Tooling is necessary and insufficient. The cultural shifts:

- **Observability-Driven Development (ODD).** Instrumentation is part of the feature's definition of done, written *with* the code — "what wide-event attributes would I need to debug this in prod?" — not bolted on after the first outage. Reviewers ask for it like they ask for tests.
- **Debug in production, routinely.** Normalise exploring prod telemetry as a daily habit, not a panic move. Engineers who only open the observability tool during incidents never build the fluency to use it well *during* incidents.
- **Watch the ones who instrument richly.** The teams that resolve incidents fast are the ones whose spans are wide and whose attributes match their domain. Make their patterns the paved road.
- **Paved roads over mandates.** Ship shared SDK config, auto-instrumentation, golden dashboards, and SLO templates so the easy path is the rich-instrumentation path. Mandates without ergonomics produce checkbox compliance (level-2 theatre).
- **Blameless incident culture.** Observability and blamelessness reinforce each other: people share what the data shows when they won't be punished for what it reveals (cross-ref [post-mortem-analysis](../post-mortem-analysis/)).

The adoption test is behavioural, not architectural: *do engineers reach for the observability tool to answer questions, including outside incidents?* If yes, you have a capability. If they only look at dashboards someone else built, you have shelfware.

---

## SLO Practice at Org Scale

One service's SLO is a senior topic; *fifty teams'* SLOs is a professional one. The failure mode is bureaucracy or theatre. (Mechanics: [engineering-metrics-and-dora](../../quality-engineering/engineering-metrics-and-dora/).)

- **Standardise the *language*, decentralise the *targets*.** Define org-wide what an SLI is (user-perceived, request-level, split success/error), how to express it as a query over wide events, and what an **error-budget policy** is. Let each team own its own SLO numbers and own its budget. Centralising target-setting creates a committee bottleneck; decentralising the *definition* creates incomparable nonsense.
- **SLOs on user journeys, not just services.** "Checkout succeeds" is a journey crossing many services; per-service SLOs can all be green while the journey is broken. Define journey-level SLOs for the things users actually do.
- **The error-budget policy must have teeth.** Pre-agree the consequence of burning the budget (freeze features, shift to reliability work). An SLO with no consequence is a vanity metric.
- **Alert on multi-window, multi-burn-rate** budget consumption, not raw thresholds — page on a fast burn that threatens the budget, ticket on a slow burn. This is the org-scale answer to alert fatigue (see `monitoring-alerting`).
- **Beware SLO inflation.** Teams set 99.99% because it *sounds* responsible, then chronically miss it and the SLO loses all meaning. Set the target at the level users actually need; an SLO you reliably meet *and* that reflects user pain is worth more than an aspirational one you ignore.

---

## Cost Governance

Telemetry is frequently a top-three infrastructure cost and grows faster than traffic (more services × more spans × more attributes). Without governance, the reflex when the bill spikes is to slash sampling — which blinds you precisely as you scale. (Deep dive: [telemetry-cost](../telemetry-cost-and-sampling-strategy/).) The governance levers:

| Lever | What it does | Where |
|---|---|---|
| **Tail sampling** | Keep all errors/slow/key-tenants, sample the boring majority | Gateway Collector |
| **Cardinality budgets** | Cap per-team metric label cardinality; alert/drop on breach | Collector + policy |
| **Attribute pruning** | Drop attributes that are never queried (pure cost) | Collector (OTTL) |
| **Retention tiers** | Hot/cheap-cold tiers; keep raw events briefly, aggregates longer | Backend config |
| **Cost attribution** | Tag telemetry by team/service so spend is showback/chargeback | Resource attributes |
| **Metrics vs traces split** | Metrics are cheap aggregates (no sampling); spend the sampling budget on traces | Pipeline design |

The professional stance: **make cost visible and attributable**, so the team generating the spend sees the spend. The most powerful single move is keeping **metrics unsampled and cheap** (they power SLOs) while aggressively tail-sampling traces — full-fidelity "something's wrong" with sampled "here's why." And resist the panic-sampling reflex: the right cut is dropping *boring* data (unqueried attributes, successful-fast-path traces), not blanket-reducing fidelity on the failures you'll need.

---

## On-Call & Incident Response

Observability's payoff is realised in the incident. (Cross-ref [post-mortem-analysis](../post-mortem-analysis/); see the `monitoring-alerting` skill for alert design.)

- **Good observability shrinks MTTR by collapsing the investigation loop.** An on-call engineer who can hypothesise → query wide events → narrow → confirm resolves in minutes; one who must add-log-and-redeploy is stuck for hours. The platform's ROI is mostly here.
- **Alerts must be actionable.** Every page should mean "a human must act now" and link to the relevant SLO and a starting query/dashboard. Non-actionable pages are alert fatigue, and fatigue causes missed real incidents — the most dangerous failure mode of all.
- **Runbooks point into the telemetry.** A good runbook is "open *this* SLO, run *this* `group by`, look for *this* pattern" — not prose. Observability turns runbooks from rituals into queries.
- **The incident timeline is reconstructed from telemetry.** Wide events with build/deploy/flag attributes let the post-mortem answer "what changed at 14:02?" precisely. Capturing `build.version` and `deployment` on events is what makes "the deploy did it" a query rather than a guess.
- **Feedback loop:** every incident either confirms the instrumentation was sufficient or names the missing attribute. Add it. Over time, ODD + this loop drive the org up the maturity model.

---

## Goodhart Pitfalls on Observability Metrics

> *Goodhart's Law: when a measure becomes a target, it ceases to be a good measure.*

Observability KPIs are unusually easy to game because the *capability* (answering unknown-unknowns) is hard to measure, so proxies get targeted instead — and proxies get optimised. (The DORA/SPACE discussion in [engineering-metrics-and-dora](../../quality-engineering/engineering-metrics-and-dora/) covers the general phenomenon.)

| Targeted metric | How it gets gamed | The real thing it was a proxy for |
|---|---|---|
| **"% of services with a dashboard"** | Auto-generate empty dashboards nobody uses | Can you actually answer questions? |
| **"Instrumentation coverage %"** | Thin auto-spans everywhere, zero business attributes | Wide, query-useful events |
| **MTTR target** | Resolve = "page acked"; or split one incident into many small "fast" ones | Genuinely faster diagnosis |
| **Alert count down** | Silence/raise thresholds until nothing fires (and real incidents are missed) | Less *noise*, not less *signal* |
| **SLO compliance %** | Set lax SLOs; define "valid request" to exclude the failures | User-perceived reliability |
| **# of custom metrics** | Emit thousands of unqueried metrics (and blow the cost) | Useful, queried signals |

Defences: **measure outcomes, not activity** (time-to-corner-a-novel-incident beats dashboard count); **use a basket of metrics** so gaming one shows up in another; **pair every quantitative KPI with qualitative signal** (do engineers say the tooling helps?); and **never tie observability metrics directly to individual performance reviews** — that guarantees gaming. The honest top-level question resists Goodharting because it's expensive to fake: *the last three novel incidents — were they cornered by querying, with no new instrumentation?*

---

## Code Examples

### Gateway Collector — org policy: tail sampling, PII redaction, span→metrics, multi-backend

```yaml
# gateway-collector.yaml  (the org POLICY enforcement point)
receivers:
  otlp: { protocols: { grpc: { endpoint: 0.0.0.0:4317 } } }

processors:
  # 1) Normalise + redact PII before anything leaves the building (one chokepoint).
  transform/redact:
    trace_statements:
      - context: span
        statements:
          - delete_key(attributes, "app.user.email")
          - replace_pattern(attributes["http.url"], "token=[^&]+", "token=REDACTED")
  # 2) Tail sampling — keep what you'll actually need; requires whole traces (see topology).
  tail_sampling:
    decision_wait: 12s
    policies:
      - { name: errors,      type: status_code, status_code: { status_codes: [ERROR] } }
      - { name: slow,        type: latency,     latency: { threshold_ms: 1000 } }
      - { name: key-tenant,  type: string_attribute,
          string_attribute: { key: app.customer.plan, values: [enterprise] } }
      - { name: rest,        type: probabilistic, probabilistic: { sampling_percentage: 3 } }
  batch: {}

connectors:
  # 3) Derive RED metrics from spans — full-fidelity metrics WITHOUT separate instrumentation.
  spanmetrics:
    histogram: { explicit: { buckets: [50ms, 100ms, 300ms, 1s, 3s] } }
    dimensions: [ { name: http.route }, { name: app.customer.plan } ]

exporters:
  otlp/tempo:     { endpoint: tempo:4317,     tls: { insecure: true } }   # sampled traces
  otlphttp/hny:   { endpoint: https://api.honeycomb.io }                  # wide-event explore
  prometheusremotewrite: { endpoint: http://mimir:9009/api/v1/push }      # UNSAMPLED metrics

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [transform/redact, tail_sampling, batch]
      exporters: [otlp/tempo, otlphttp/hny, spanmetrics]   # spanmetrics fans into metrics
    metrics:
      receivers: [spanmetrics]
      processors: [batch]
      exporters: [prometheusremotewrite]                   # metrics are NOT tail-sampled
```

This one file is org-level governance: PII can't leak, fidelity is allocated, RED metrics are free and unsampled, and three backends are fed without a single app redeploy.

### Agent Collector — trace-aware routing to the gateway (the tail-sampling prerequisite)

```yaml
# agent-collector.yaml  (per-node DaemonSet)
receivers:
  otlp: { protocols: { grpc: { endpoint: 0.0.0.0:4317 } } }
processors:
  k8sattributes: {}     # enrich with pod/namespace/node — node context lives near the node
  batch: {}
exporters:
  # Route ALL spans of a trace to the SAME gateway replica, hashing by trace_id,
  # so tail sampling downstream sees whole traces.
  loadbalancing:
    routing_key: traceID
    protocol: { otlp: { tls: { insecure: true } } }
    resolver: { dns: { hostname: otel-gateway-headless } }
service:
  pipelines:
    traces: { receivers: [otlp], processors: [k8sattributes, batch], exporters: [loadbalancing] }
```

### Java — shared SDK config as a paved road (auto-instrument + standard resource attributes)

```java
// Started via the OpenTelemetry Java agent; this config is the org "paved road".
// -javaagent:opentelemetry-javaagent.jar
//   OTEL_SERVICE_NAME=checkout
//   OTEL_RESOURCE_ATTRIBUTES=service.version=4.2.1,deployment.environment=prod,team=payments
//   OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-agent:4317
//   OTEL_TRACES_SAMPLER=parentbased_always_on   // SAMPLE AT THE TAIL in the gateway, not here
//
// Teams add only business attributes; the platform owns the rest.
import io.opentelemetry.api.GlobalOpenTelemetry;
import io.opentelemetry.api.trace.Span;

void onCheckout(Checkout c) {
    Span span = Span.current();                      // auto-created by the agent
    span.setAttribute("app.account.id", c.accountId());   // identity (high-card: fine on a span)
    span.setAttribute("app.customer.plan", c.plan());     // business dimension to group by
    span.setAttribute("app.payment.provider", c.provider());
}
```

The platform ships the agent, the resource attributes (including `team` for cost attribution), and the "sample at the tail, not the head" decision. Teams write only the domain attributes — the paved road that makes rich instrumentation the easy path.

---

## Use Cases

| Situation | Professional move |
|---|---|
| 200 polyglot services, inconsistent telemetry | OTel paved road: shared agent config, golden dashboards, standard resource attributes |
| Tail sampling needed across replicas | Trace-aware load-balancing exporter (hash by `trace_id`) → sharded gateway tier |
| PII must never reach a SaaS backend | Redaction stage in the gateway as the single chokepoint |
| Telemetry bill is a top-3 cost | Tail-sample traces, keep metrics unsampled, cardinality budgets, cost attribution by `team` |
| Build-vs-buy under debate | OTel as the hedge; per-signal, reversible choice (OSS metrics + SaaS wide-event explore) |
| SLO practice has become theatre | Standardise the SLI language, decentralise targets, error-budget policy with teeth, journey-level SLOs |
| Org stuck at "we have three pillars" | Push 2→3→4: shared `trace_id`, exemplars, then wide-event ad-hoc querying |
| "100% have dashboards" but incidents still slow | Goodhart trap — measure time-to-corner-a-novel-incident instead |

---

## Mental Models

### 1. The platform is a product; teams are its customers

Make rich instrumentation the easy path and the wrong thing hard. Paved roads, self-service, defaults — not mandates. Adoption is measured by behaviour, not coverage percentages.

### 2. The gateway Collector is the policy plane

Tail sampling, redaction, normalisation, cost control, routing — all centralised in the gateway, changeable without app redeploys. Owning the topology is owning governance.

### 3. OTel is the reversibility hedge

Because everything speaks OTLP through the Collector, build-vs-buy is a per-signal, reversible decision instead of a one-way door. Instrument once; keep the backend question open.

### 4. Metrics cheap and full-fidelity; traces sampled and rich

The economic core of cost governance: counters count everything cheaply (and power SLOs), while per-event traces are tail-sampled for fidelity-where-it-matters. "Something's wrong" at full fidelity; "here's why" sampled.

### 5. Maturity is correlation, then ad-hoc query

The leap that matters is 2→3→4: from siloed signals, to correlated signals, to answering unknown-unknowns. Three expensive disconnected pipelines is not observability.

### 6. Every observability metric will be gamed

If it's a target, it'll be optimised — usually away from the capability it proxied. Measure outcomes, use a basket, pair with qualitative signal, and never tie to individual reviews.

---

## Best Practices

1. **Layer the Collector:** agents for local enrichment/batching, a gateway tier for tail sampling, redaction, normalisation, span-metrics, and routing.
2. **Route by `trace_id`** (load-balancing exporter) so tail sampling sees whole traces — this constraint shapes the whole topology.
3. **Redact PII at one chokepoint** in the gateway, especially before any SaaS export.
4. **Keep metrics unsampled and cheap; tail-sample traces** for fidelity-where-it-matters; SLOs come from the unsampled metrics.
5. **Use OTel as the reversibility hedge** — make build-vs-buy a per-signal, reversible choice.
6. **Ship paved roads:** shared SDK/agent config, golden dashboards, SLO templates, standard resource attributes (incl. `team` for cost attribution).
7. **Standardise the SLI language, decentralise targets**, define journey-level SLOs, and give the error-budget policy real teeth.
8. **Govern cost** with cardinality budgets, attribute pruning, retention tiers, and showback — make spend visible to the team that creates it.
9. **Make every alert actionable** and link it to an SLO + a starting query; ruthlessly cut non-actionable pages.
10. **Measure observability by outcomes** (time-to-corner-a-novel-incident), resist Goodhart, never tie to individual performance.

---

## Edge Cases & Pitfalls

- **Sharded gateways breaking tail sampling.** Round-robining spans across replicas gives each a fragment → wrong decisions. Route by `trace_id`.
- **Tail-sampler memory pressure** from long-lived traces (a 30-minute trace pins memory in the gateway). Cap durations; size the tier; tune `decision_wait`.
- **PII leaking to a SaaS** because redaction was per-service and one service skipped it. Centralise redaction in the gateway.
- **SLO theatre:** aspirational 99.99% targets chronically missed and ignored, or "valid request" defined to exclude the failures. Set targets to real user need.
- **Per-service SLOs all green, the user journey broken.** Add journey-level SLOs.
- **Cost panic → blanket sampling cut** that blinds you as you scale. Cut *boring* data, not failure fidelity; keep metrics unsampled.
- **Cardinality bombs from resource attributes** (`host.name` per pod) inflating metric series. Fine on events; guard as metric labels.
- **Goodharted KPIs:** dashboards/coverage/MTTR targets gamed into meaninglessness. Measure outcomes; basket of metrics; qualitative signal.
- **"Single pane of glass" as a procurement slogan** — buying one tool doesn't create correlation; correlation is shared `trace_id` + exemplars + wiring.

---

## Common Mistakes

1. **Treating observability as a tooling purchase.** A SaaS contract doesn't make you observable; rich instrumentation + correlation + culture do.
2. **No gateway tier**, so tail sampling/redaction/cost control are scattered into apps and can't change without redeploys.
3. **Round-robin span routing** that silently corrupts tail-sampling decisions.
4. **Sampling metrics** (then computing SLOs from them and getting the error rate wrong) — metrics should be unsampled.
5. **Mandating coverage without ergonomics** — checkbox compliance, thin spans, level-2 theatre.
6. **SLOs with no error-budget policy** — vanity numbers with no consequence.
7. **Slashing sampling when the bill spikes** instead of dropping unqueried/boring data — going blind at scale.
8. **Targeting observability KPIs** (dashboard count, MTTR) and getting them gamed; tying them to individual reviews.

---

## Tricky Points

1. **Tail sampling forces topology.** Because the decision needs the whole trace, you *must* route by `trace_id` to a sticky gateway — this is why a gateway tier exists, and why you can't just scale Collectors statelessly for traces.
2. **Metrics and traces want opposite sampling.** Metrics: unsampled (cheap aggregates, power SLOs). Traces: sampled (per-event, expensive). Designing them the same way breaks either cost or SLO accuracy.
3. **OTel makes build-vs-buy reversible and per-signal** — the strategic value of OTel is as much about *keeping the question open* as about instrumentation.
4. **The maturity leap is correlation, not coverage.** You can have 100% of services emitting all three pillars and still be at level 2 if they share no identity.
5. **Cost governance and visibility blindness trade off.** The cheapest pipeline is the one that records nothing; the value is in keeping the *right* fidelity, not minimising volume.
6. **Goodhart hits observability harder than most domains** because the real capability is hard to measure, so easy proxies get targeted and gamed.
7. **PII redaction belongs in the gateway, not the app** — one chokepoint you can audit, versus N services any one of which can leak.

---

## Test Yourself

1. Draw the agent→gateway Collector topology. What lives where, and why does tail sampling force a `trace_id`-aware load balancer?
2. Why must metrics be unsampled while traces are tail-sampled? What breaks if you sample metrics?
3. Give the build-vs-buy decision framework. How does OTel change the nature of the decision?
4. Place an org at a maturity level from a one-line description, and name the next leap. Why is 2→3 the hard one?
5. What is Observability-Driven Development, and what's the behavioural test for whether adoption succeeded?
6. How do you run SLO practice across fifty teams without bureaucracy or theatre? Why journey-level SLOs?
7. List five cost-governance levers and where each lives. Why is "slash sampling" the wrong reflex?
8. Give three observability KPIs and exactly how each gets Goodharted. What defends against it?
9. Design the gateway processing pipeline for a payments platform: redaction, tail sampling, span-metrics, multi-backend. Justify the ordering.

---

## Cheat Sheet

```text
┌──────────────── OBSERVABILITY ENGINEERING — PROFESSIONAL CHEAT SHEET ────────────────────────┐
│                                                                                               │
│  PLATFORM = pipeline + policy + product. teams are your customers; paved roads > mandates.    │
│                                                                                               │
│  COLLECTOR TOPOLOGY                                                                            │
│    AGENT (per-node): receive · k8s-enrich · batch · route-by-trace_id                          │
│    GATEWAY (scaled): TAIL SAMPLING · PII redaction · normalise · span→metrics · routing        │
│    tail sampling needs WHOLE traces → load-balance by trace_id to a STICKY gateway replica     │
│                                                                                               │
│  BACKENDS / BUILD-vs-BUY                                                                       │
│    OSS: Prometheus/Mimir(metrics) Grafana Tempo(traces) Loki(logs) — control, TSDB card ceiling│
│    SaaS: Honeycomb (wide-event/high-card) · Datadog (turnkey, volume-priced)                   │
│    OTel = the HEDGE → per-signal, REVERSIBLE choice. most orgs go hybrid.                       │
│                                                                                               │
│  MATURITY: 0 reactive →1 monitor →2 structured(siloed) →3 CORRELATED →4 OBSERVABLE →5 proactive│
│    the leap that matters = 2→3→4 (correlation, then ad-hoc query on unknown-unknowns)          │
│                                                                                               │
│  COST GOVERNANCE                                                                               │
│    metrics UNSAMPLED+cheap (power SLOs) │ traces TAIL-SAMPLED (fidelity where it matters)       │
│    cardinality budgets · attribute pruning · retention tiers · showback by team                │
│    bill spikes → drop BORING data, NOT failure fidelity                                        │
│                                                                                               │
│  SLO@SCALE: standardise the LANGUAGE, decentralise TARGETS; journey-level; budget policy w/teeth│
│  GOODHART: measure OUTCOMES (time-to-corner-a-novel-incident), basket of metrics, never reviews │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Summary

- **Observability at org scale is a platform with policy and a product surface.** Teams are the customers; the platform's job is to make rich instrumentation the easy path (paved roads) and the wrong thing hard (cardinality/PII guardrails).
- **The Collector topology is the policy plane.** Agents enrich and batch near the workload; a gateway tier does tail sampling, PII redaction, normalisation, span-metrics, and routing — centrally, without app redeploys. Tail sampling needs whole traces, which forces `trace_id`-aware routing to a sticky gateway replica.
- **Backends set the capability ceiling and a big share of cost.** OSS (Prometheus/Grafana/Tempo/Loki) gives control and a TSDB cardinality ceiling; SaaS (Honeycomb's wide-event model, Datadog's turnkey breadth) buys capability for money. **OTel is the hedge** that makes build-vs-buy a per-signal, reversible choice — most orgs run hybrid.
- **The maturity model** runs reactive → monitoring → structured → correlated → observable → proactive; the leap that matters is correlation then ad-hoc querying of unknown-unknowns. Many orgs stall at three siloed pillars.
- **Adoption is cultural:** Observability-Driven Development, routine prod debugging, blameless post-mortems, paved roads over mandates. The test is behavioural — do engineers query the tool to answer questions, including outside incidents?
- **SLOs scale by standardising the language and decentralising targets**, defining journey-level SLOs, and giving the error-budget policy teeth.
- **Cost governance** keeps metrics unsampled and cheap (SLOs) while tail-sampling traces for fidelity-where-it-matters; cut boring data, not failure fidelity; attribute spend to teams.
- **Observability metrics get Goodharted** because the real capability is hard to measure — measure outcomes, use a basket, pair with qualitative signal, and never tie to individual performance.

---

## Further Reading

- *Observability Engineering* — Charity Majors, Liz Fong-Jones, George Miranda (O'Reilly) — wide events, maturity, the cultural argument.
- *Site Reliability Engineering* & *The Site Reliability Workbook* — Google — SLOs, error-budget policy, multi-burn-rate alerting, on-call.
- **OpenTelemetry Collector docs** — <https://opentelemetry.io/docs/collector/> — receivers/processors/exporters, the load-balancing exporter, tail-sampling processor, OTTL.
- **"Scaling the OpenTelemetry Collector"** and tail-sampling architecture write-ups — agent/gateway topology and the `trace_id` routing constraint.
- *Implementing Service Level Objectives* — Alex Hidalgo (O'Reilly) — SLO practice at scale.
- The `observability-stack` and `monitoring-alerting` skills — backend selection and humane alert design.
- [Quality Engineering → Engineering Metrics & DORA](../../quality-engineering/engineering-metrics-and-dora/) — DORA/SPACE and the Goodhart discussion.

---

## Related Topics

- **Down a level:** [senior.md](senior.md) — wide-event design, cardinality economics, span/data-model design, the debugging loop, SLO/alerting fundamentals.
- **Foundations:** [middle.md](middle.md) · [junior.md](junior.md).
- **Interview prep:** [interview.md](interview.md). **Practice:** [tasks.md](tasks.md).

**Sibling diagnostic topics:**

- [Telemetry Cost & Sampling Strategy](../telemetry-cost-and-sampling-strategy/) — the cost/sampling deep dive.
- [Tracing](../tracing/) · [Metrics](../metrics/) · [Logging](../logging/) · [Continuous Profiling](../continuous-profiling/) — the signals the platform carries.
- [Dynamic Instrumentation & eBPF](../dynamic-instrumentation-and-ebpf/) — observing without code changes.
- [Crash Reporting](../crash-reporting/) · [Post-Mortem Analysis](../post-mortem-analysis/) — incident follow-through.

**Cross-roadmap links:**

- [Quality Engineering → Engineering Metrics & DORA](../../quality-engineering/engineering-metrics-and-dora/) — SLOs/error budgets and Goodhart.
- [Quality Engineering → Testing → Testing in Production](../../quality-engineering/testing/13-testing-in-production/) — observability as its prerequisite.

---

## Diagrams & Visual Aids

### Agent → Gateway topology (and the tail-sampling constraint)

```text
  services ─OTLP─► AGENT (per node)            GATEWAY TIER (scaled)
                   k8s-enrich · batch          ┌────────────────────────────┐
                   route by trace_id ─────────►│ replica that owns this trace│
                   (load-balancing exporter)   │  tail sample · redact PII   │
                                               │  normalise · span→metrics    │
                                               └──────┬──────────┬───────────┘
                                                      ▼          ▼
                                              traces (sampled)  metrics (UNSAMPLED)
                                              → Tempo/Honeycomb → Prometheus/Mimir
   ✗ round-robin spans → each replica sees a fragment → WRONG tail decision
   ✓ hash by trace_id → one replica sees the whole trace → CORRECT decision
```

### Build-vs-buy with OTel as the hedge

```text
            ┌──────── OTel SDK (instrument ONCE, vendor-neutral) ────────┐
            │                       OTLP via Collector                    │
            ▼                                                             ▼
     OSS (build): Prometheus/Grafana/Tempo/Loki        SaaS (buy): Honeycomb / Datadog
       control · TSDB card ceiling · ops toil            capability now · volume-priced
            └──────── reversible, PER-SIGNAL choice (most orgs go hybrid) ──────────┘
```

### The maturity ladder

```text
   0 reactive ─► 1 monitoring ─► 2 structured(SILOED) ─► 3 CORRELATED ─► 4 OBSERVABLE ─► 5 proactive
   grep boxes    threshold       3 pillars, no            shared trace_id  wide-event       ODD, prod
                 alerts          shared identity          + exemplars      ad-hoc query     exploration
                                  └──── the leap that matters: 2 → 3 → 4 ────┘
```

### Cost governance: fidelity allocation

```text
   metrics ───────────────────────────────────► UNSAMPLED · cheap aggregates · power SLOs
   traces  ─► [gateway tail sampler] ─► keep 100%: errors · slow · key tenants
                                        keep   3%: boring successful majority
   + cardinality budgets · attribute pruning · retention tiers · showback by team
   bill spikes? → drop BORING data, never failure fidelity.
```

---
