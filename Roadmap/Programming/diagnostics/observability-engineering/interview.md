# Observability Engineering — Interview Questions

> **Topic:** [Observability Engineering Roadmap](README.md)
> **Focus:** Questions an interviewer can actually ask about observability as a discipline — observability vs monitoring, the three-pillars critique and the wide event, cardinality economics, OpenTelemetry, SLOs/error budgets, sampling and fidelity, the debugging loop, and platform/topology design. Graduated junior → staff, with a note on *what's really being tested* and trap questions that explain why the obvious answer is wrong.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Conceptual / Foundational](#conceptual--foundational)
3. [The Pillars & Wide Events](#the-pillars--wide-events)
4. [Cardinality & Data Model](#cardinality--data-model)
5. [OpenTelemetry](#opentelemetry)
6. [SLO / SLI](#slo--sli)
7. [Tricky / Trap Questions](#tricky--trap-questions)
8. [System / Design Scenarios](#system--design-scenarios)
9. [Behavioral / Experience](#behavioral--experience)
10. [What I'd Ask a Candidate Now](#what-id-ask-a-candidate-now)
11. [Cheat Sheet](#cheat-sheet)
12. [Further Reading](#further-reading)
13. [Related Topics](#related-topics)

---

## Introduction

Observability interviews split into two flavours. The first is "do you know the vocabulary" — can you define observability vs monitoring, name the three pillars, explain what OpenTelemetry is, recite SLI/SLO/error-budget. A junior is expected to clear that. The second, where senior and staff candidates earn their title, is "do you understand the *economics and the synthesis*" — why the same `user.id` field that OOM-kills a Prometheus server is the whole point of a wide event; why "we have logs, metrics, and traces" does *not* mean you're observable; why a flood of fast `500`s makes your latency dashboard look *better* while customers scream; and how you design a Collector topology so tail sampling actually works.

This file is the question bank, graduated junior → staff. Trap questions explain *why* the obvious instinct is wrong, because in production the wrong instinct is the expensive part — in observability, "expensive" frequently means either "the monitoring system is the outage" or "we're blind during the incident we built the system for." Each question carries a short **🎯 what's really being tested** note. The design section is where staff candidates prove they can reason about the platform under constraints — cardinality budgets, fidelity allocation, build-vs-buy, the org's maturity.

---

## Conceptual / Foundational

### Q: What is the difference between monitoring and observability?

**Monitoring** watches a *predefined* set of signals against *predefined* thresholds — you predict the failure modes, build a dashboard and an alert for each, and get paged when one trips. It answers **known-unknowns**: "Is CPU high? Is the error rate above 1%?" **Observability** is the *property* of being able to ask **arbitrary new questions** of the system from the outside, without deploying new code — the **unknown-unknowns**: "Why are checkouts failing, but only for enterprise customers, on the new payment provider, in eu-west, since the 14:02 deploy?" Nobody built that dashboard; you answer it by slicing telemetry along dimensions you captured but never pre-aggregated.

The term comes from **control theory** (Kálmán, 1960): a system is observable if its internal state can be reconstructed from its external outputs. Crucially, observability *subsumes* monitoring — you still want cheap predefined alerts for the predictable; you don't run an ad-hoc query to learn the disk is full.

> 🎯 **What's really being tested:** Whether you grasp that the distinction is about *question class* (known vs unknown unknowns), not about tooling tiers. Weak answers say "observability is monitoring plus tracing." Strong answers reach for control theory and the "no deploy to ask a new question" test.

**What-if — "Isn't observability just a fancy word for good monitoring?"** No. Good monitoring still only answers the questions you anticipated. Observability is the ability to answer the ones you *didn't* — and the test is whether a novel failure can be cornered by querying existing data with zero new instrumentation.

### Q: What are the three pillars of observability?

Logs, metrics, and traces. **Logs** are discrete, usually structured records of events. **Metrics** are aggregated numeric measurements over time (counters, gauges, histograms). **Traces** follow one request across services as a tree of timed spans. A fourth signal, **continuous profiles**, is increasingly added.

But the senior framing immediately follows: the "three pillars" are *output formats*, not the goal. Having all three does not make you observable if they're three disconnected silos with no shared identity. The unifying idea is the **arbitrarily-wide structured event**, of which the pillars are projections.

> 🎯 **What's really being tested:** Can you name them *and* signal that you know the framing's limits? A candidate who recites the three pillars and stops is junior; one who adds "but that's an implementation detail, the real unit is the wide event" is showing senior depth.

### Q: What is a "wide event" and why does it matter?

An **arbitrarily-wide structured event** is one event per unit of work (per request/operation/span) carrying *every* dimension you might want to query — dozens to hundreds of fields: identity (`user.id`, `tenant.id`), provenance (`build.version`, `region`, `host`), business shape (`customer.plan`, `cart.value`, `payment.provider`), and mechanics (`retry.count`, `cache.hit`). It's stored **raw and queried ad hoc**, not pre-aggregated. It matters because it's the unit that lets you answer unanticipated questions: you can `group by` any field, including high-cardinality ones, to corner a novel failure. In OTel terms, **a span IS a wide event**.

> 🎯 **What's really being tested:** Whether you understand that observability comes from *raw, high-dimensionality events queried at read time*, not from pre-aggregated dashboards.

### Q: Where does observability sit relative to the SRE/reliability practice?

Observability is the *capability* that makes reliability practice possible. SLOs/SLIs are computed from the same telemetry; error budgets decide what to fix; on-call response collapses from hours to minutes when the data answers questions. Observability is the substrate; SLOs are the user-facing contract layer on top of it (cross-ref [engineering-metrics-and-dora](../../quality-engineering/engineering-metrics-and-dora/)).

> 🎯 **What's really being tested:** Systems thinking — that observability isn't a tooling silo but the foundation of the whole reliability stack.

---

## The Pillars & Wide Events

### Q: Give the three-pillars critique. What does it propose instead?

Three points: (1) the pillars are output formats, not a goal — having all three doesn't make you observable; (2) each pillar throws away what the others need — metrics pre-aggregate away per-request detail, traditional logs are unstructured and hard to query by dimension, traces are often sampled blind; (3) the real unit is the arbitrarily-wide structured event, queried not pre-aggregated, from which metrics (group-by), traces (same `trace_id`), and logs (span events) are all *projections*.

> 🎯 **What's really being tested:** Charity Majors' argument. The trap is reciting the pillars as gospel; the signal is articulating why they're insufficient and what replaces the framing.

### Q: If a span is a wide event, how do you get a metric, a trace, and a log from it?

- **Metric:** `COUNT` / heatmap of spans grouped by a *low*-cardinality field (e.g. RED by `http.route`). Many backends derive these via a span-metrics connector.
- **Trace:** the set of spans sharing a `trace_id`, ordered by time and parent/child.
- **Log:** one span (or a span event inside it) rendered as a record.

The win: correlation is *inherent* (they share `trace_id`, resource attributes, context) rather than stitched after the fact.

> 🎯 **What's really being tested:** That you actually understand "pillars as projections," concretely, not as a slogan.

### Q: Why is "we have logs, metrics, and traces" not the same as "we are observable"?

Because three silos with no shared identity answer nothing *new*. Observability requires *correlation* — a shared `trace_id` across signals, exemplars linking metrics to traces, the ability to pivot from a metric spike to the exact trace to its logs to a profile — *and* events rich enough (wide, high-cardinality) to slice along an unanticipated dimension. You can have all three pillars and still be unable to answer the 3 a.m. question.

> 🎯 **What's really being tested:** Whether you conflate having signals with having the capability. This is the single most common conceptual error.

---

## Cardinality & Data Model

### Q: What is cardinality, and why is high cardinality both a killer and a superpower?

**Cardinality** is the number of distinct values a field takes (`http.method` is low; `user.id` is high). In a **TSDB** (Prometheus), each unique label-set is a separate time series, so a high-cardinality *label* like `user.id` creates one series per user — millions of series, index/memory blowup, an OOM. There, high cardinality is catastrophic. In a **wide-event store** (Honeycomb, ClickHouse-backed tracing), there's no per-combination series — `user.id` is just a column you filter and `group by` at query time, and slicing to the one affected customer is the entire point. **Same field, opposite economics, because the aggregation happens at write time (TSDB) vs query time (wide-event store).**

> 🎯 **What's really being tested:** *The* core observability-economics insight. Strong answers name *where* aggregation happens as the cause. This question separates people who've read about observability from people who understand it.

**What-if — "So should I put `user.id` on my metrics?"** Never as a Prometheus label — you'll explode the series count. Put it on the *span/event*, where it's free to query. The split (high-card detail on events, low-card on metric labels and span names) is the whole design rule.

### Q: A trace shows `GET /users/12345`, `GET /users/67890`, etc. — what's wrong?

The span *name* is carrying a high-cardinality value (the ID). Span names become a dimension (often a derived span-metric), so this re-creates the cardinality explosion *inside the tracing backend*. The fix: name the span with the route template `GET /users/:id` and put the ID in an **attribute** (`user.id`). Low-cardinality name, high-cardinality detail in attributes.

> 🎯 **What's really being tested:** That cardinality discipline applies to span names too, not just metric labels.

### Q: How would you design the attribute set for a new service's entry span?

Capture, on the top span of every request, four categories: **identity** (`user.id`, `tenant.id`, `account.id`), **provenance** (`build.version`, `region`, `availability_zone`, `host.name`, `deployment.env`), **business shape** (`customer.plan`, `cart.value`, `payment.provider`, feature flags), and **mechanics** (`retry.count`, `cache.hit`, `db.pool.wait_ms`). The test for each attribute: *"Could a future incident be explained by grouping on this field?"* If yes, capture it — it's cheap now and impossible to add retroactively. Use OTel semantic conventions for standard fields, a clear namespace (`app.*`) for your domain.

> 🎯 **What's really being tested:** Whether you design observability *for the questions you can't yet imagine* — the senior data-model skill. The "could an incident be explained by grouping on this?" heuristic is the tell.

### Q: Why can you only debug along dimensions you captured?

Because querying is filtering and grouping over fields that exist on the stored events. No amount of clever querying recovers a dimension that was never written. This is why instrumentation design is a *bet about future questions* — and why you capture identity/provenance/business-shape proactively rather than after the first outage.

> 🎯 **What's really being tested:** The irreversibility of instrumentation decisions, which is what makes design matter.

---

## OpenTelemetry

### Q: What is OpenTelemetry, in three parts?

A vendor-neutral CNCF standard, made of: (1) a **specification** — a language-agnostic data model and semantic conventions for traces, metrics, logs, and profiles; (2) **SDKs** — one per language, implementing the spec (create spans/metrics, sample, batch, export); (3) the **Collector** — a standalone process (receivers → processors → exporters) that receives, processes, and routes telemetry. You instrument *once* with OTel and point it at *any* backend — that portability is why it won the instrumentation war.

> 🎯 **What's really being tested:** Whether you know OTel is more than a tracing library — it's the unifying substrate for all signals.

### Q: Why does OTel separate the API from the SDK?

So third-party libraries can emit telemetry by depending on the *API only*, which does nothing until *your application* installs the *SDK* (which decides sampling/batching/export). A database driver can be instrumented without forcing a backend on its users — the application chooses. It also means you can swap the SDK without changing instrumentation code.

> 🎯 **What's really being tested:** A subtle architectural point that signals real OTel familiarity.

### Q: A trace is perfect within each service but never crosses the network. Diagnose.

**Context propagation** isn't happening. Either both ends aren't using OTel HTTP instrumentation (so the `traceparent` header isn't injected/extracted), or the hop is **non-HTTP** (a queue/job) where you must inject/extract context into message headers manually — the #1 place traces break — or the two ends use **different propagators** (B3 vs W3C) and the header is ignored. Fix the propagation and the fragments join into one connected trace.

> 🎯 **What's really being tested:** Practical debugging of the most common real-world OTel failure. The async-boundary answer is what distinguishes hands-on experience.

### Q: What is the Collector for, and why run one even at small scale?

It decouples your apps from your backends. Sampling, PII redaction, attribute normalisation, backend routing, and span-metrics all live in the Collector — so you can switch backends, add tail sampling, or scrub PII **without redeploying any service**. Even at small scale it's the single place to change everything downstream of your code.

> 🎯 **What's really being tested:** Whether you see the Collector as the policy/governance plane, not just a relay.

### Q: What's an exemplar, and what must be true for it to work?

An **exemplar** is a `trace_id` attached to a metric data point (a histogram bucket observation), letting you jump from a latency spike to *an actual trace in that bucket*. For it to attach, the metric must be **recorded inside an active span** (the SDK reads the current `trace_id` at record time), *and* the linked trace must survive sampling (don't sample out the error/slow traces exemplars point to).

> 🎯 **What's really being tested:** The metric→trace link, and the two independent gotchas that silently produce empty exemplars.

### Q: Auto vs manual instrumentation — which do you use?

Both. **Auto** gives breadth for near-zero effort — HTTP, DB, queues traced automatically — but knows nothing about your domain. **Manual** gives the business attributes and spans that actually solve incidents (`customer.plan`, `fraud.score`, "apply discount rules"). Strategy: auto-instrument everywhere for coverage, then enrich the auto-created spans with business attributes and add manual spans only around meaningful domain operations.

> 🎯 **What's really being tested:** That you won't fall into either ditch — all-auto (no domain context) or all-manual (no coverage, huge effort).

---

## SLO / SLI

### Q: Define SLI, SLO, and error budget.

**SLI (Indicator):** a measured ratio of *good events / valid events* — e.g. `(requests with status < 500 AND latency < 300ms) / (all valid requests)`. **SLO (Objective):** the target — e.g. 99.9% over 28 days. **Error budget:** `1 − SLO` — the allowed failure (99.9% over 28 days ≈ 40 minutes). Burn it slowly and you ship features; burn it fast and you stop and fix reliability. (Mechanics: [engineering-metrics-and-dora](../../quality-engineering/engineering-metrics-and-dora/).)

> 🎯 **What's really being tested:** Definitions plus the *consequence* (error-budget policy). An SLO with no policy is a vanity number.

### Q: How does observability relate to SLIs?

An SLI is *a query over your wide events* — a filter for "good" over "valid." If your events are well-designed, the SLI is just a filter; if they aren't, you can't even define a good user-perceived SLI. And measure from the **user's perspective** (request-level success), not a server-side resource metric — "CPU < 80%" is not an SLI; "checkout p99 < 300ms" is.

> 🎯 **What's really being tested:** The link between data-model design and the ability to define meaningful SLOs.

### Q: Why alert on error-budget burn rate rather than thresholds?

Threshold alerts page on single-data-point wobbles (noise → alert fatigue). **Burn-rate** alerts page when you're consuming the budget fast enough to exhaust it soon — a real threat — using multi-window, multi-burn-rate logic (fast burn → page now, slow burn → ticket). This is the humane, actionable way to alert (see the `monitoring-alerting` skill).

> 🎯 **What's really being tested:** Maturity about alerting — that the goal is actionable pages, not maximal coverage.

---

## Tricky / Trap Questions

### Q: Our p99 latency *dropped* during an outage customers are furious about. How?

Fast failures. The service started returning `500`s in 2ms, which drags the *overall* p99 *down* even as users get errors — speed and success are orthogonal. The fix: **split duration by status class** (success-latency and error-latency separately) so a flood of fast failures can't flatter the percentile.

> 🎯 **What's really being tested:** Whether you know latency without a success/error split is a lie. A classic trap that catches people who treat p99 as sacred.

### Q: We sample 1% of traces to save money and we keep missing the errors we need. Why, and fix it?

Naïve **head sampling** decides at trace *start*, before knowing if the trace is interesting — so 1% sampling keeps 1 in 100 errors, and the rare failure is exactly what you wanted. Fix: **tail sampling** in the Collector — buffer the whole trace, then keep 100% of errors and slow traces and sample only the boring fast majority. Allocate fidelity to what you'll need.

> 🎯 **What's really being tested:** The fidelity-allocation insight — that sampling is a *choice of what to keep*, not a blanket percentage.

### Q: We computed our error rate from traces and it's wrong. Why?

The traces are *sampled*, so any count derived from them is off by the sampling factor. SLIs/error rates must come from **unsampled metrics** (counters count everything cheaply) — never from sampled traces. Metrics tell you *that* something's wrong at full fidelity; the retained error traces tell you *why*.

> 🎯 **What's really being tested:** That metrics and traces have opposite sampling needs and you must not cross the wires.

### Q: Adding `user_id` as a Prometheus label took down our monitoring. But the docs say high cardinality is observability's superpower — contradiction?

No contradiction — it's the core point. High cardinality is poison in a TSDB (one series per value → series explosion → OOM) and gold in a wide-event store (one filterable column → slice to one customer). The "superpower" applies to *event/trace stores that aggregate at query time*, not to *metrics backends that aggregate at write time*. Put `user.id` on the span, never on a metric label.

> 🎯 **What's really being tested:** Whether you can reconcile the two facts with the write-time-vs-query-time aggregation distinction. The strongest single discriminator in an observability interview.

### Q: We bought a top-tier observability SaaS but still can't debug incidents. Why?

Tooling doesn't create observability — rich instrumentation, correlation, and culture do. Likely causes: thin spans with no business attributes (you can trace the plumbing but not slice by customer/plan/build), no shared `trace_id` across signals, no exemplars, or engineers who only open the tool during incidents and lack the fluency to use it. A SaaS contract gets you a query engine; you still have to feed it wide events and build the correlation links.

> 🎯 **What's really being tested:** That observability is a capability, not a purchase — the most expensive misconception at the org level.

### Q: "Single pane of glass" — sell me on it or push back.

Push back on it as a *procurement slogan*. One UI doesn't create correlation; correlation is a shared `trace_id`, exemplars, and the wiring between signals. A single pane is *valuable* when it's a genuine pivot layer (metric spike → exemplar → trace → logs → profile), and *hollow* when it's just three disconnected tabs in one product. Buy the pivot, not the tab count.

> 🎯 **What's really being tested:** Resistance to marketing, and understanding that correlation is engineered, not bought.

---

## System / Design Scenarios

### Q: Design observability for a payments platform.

Frame it end to end:

1. **Instrumentation (the data model).** OTel everywhere. Wide entry span per request with **identity** (`account.id`, `merchant.id`, `user.id`), **provenance** (`build.version`, `region`, `host`), **business shape** (`payment.provider`, `amount`, `currency`, `card.network`, `risk.score`, feature flags), and **mechanics** (`retry.count`, `provider.latency_ms`, `idempotency.key`). Low-cardinality span names (route templates), high-cardinality detail in attributes. Record metrics inside spans for exemplars.
2. **Pipeline.** Agent Collectors (per-node, k8s enrichment, route by `trace_id`) → gateway tier (tail sampling, **PII/PAN redaction** as a hard chokepoint — card numbers must never reach a backend, span→metrics connector, normalisation, multi-backend routing).
3. **Backends.** Unsampled metrics in Prometheus/Mimir (SLOs); tail-sampled traces in Tempo or a wide-event store (Honeycomb) for high-cardinality exploration; logs in Loki, `trace_id`-correlated.
4. **SLOs.** Journey-level: "payment authorised within 2s," "settlement succeeds." User-perceived, split success/error latency, burn-rate alerts, error-budget policy with teeth.
5. **Fidelity & cost.** Tail-sample to keep 100% of errors, slow traces, and high-value/large-amount transactions; sample the boring majority; metrics unsampled.
6. **Debugging.** Capture identity so a merchant report ("txn X failed at 14:03") is a query; build metric→trace→log→profile correlation before incidents.
7. **Compliance.** PII/PAN redaction in the gateway, audited; cost attribution by team.

> 🎯 **What's really being tested:** End-to-end reasoning — data model, pipeline topology, backend split, SLOs, fidelity/cost, and the domain-specific PCI/PII constraint. Staff candidates volunteer the redaction chokepoint and the unsampled-metrics-for-SLOs point unprompted.

### Q: Design the Collector topology for tail sampling across 200 services.

Two tiers. **Agents** (per-node DaemonSet): receive OTLP, enrich with k8s/host metadata, batch, and — critically — export to the gateway using a **trace-aware load-balancing exporter that hashes by `trace_id`**. **Gateway** (scaled deployment): each replica receives all spans of the traces routed to it, so it can make a correct **tail-sampling** decision (it needs the *whole* trace), plus redaction, normalisation, span-metrics, and routing. The constraint that shapes everything: tail sampling requires whole traces on one instance, so you cannot round-robin spans — route by `trace_id` to a sticky replica. As volume grows, split the routing layer from the sampling layer.

> 🎯 **What's really being tested:** The single hardest platform-architecture fact in observability — that tail sampling forces `trace_id`-stable routing. Getting this is a strong staff signal.

### Q: Our telemetry bill is the #1 infra cost and growing. What do you do — without going blind?

Don't reflexively slash sampling (that blinds you as you scale). Instead: (1) **tail-sample traces** — keep errors/slow/key-tenants at 100%, sample the boring successful majority; (2) keep **metrics unsampled** (they're cheap aggregates and power SLOs); (3) **cardinality budgets** per team and **drop unqueried attributes** (OTTL) — pure cost; (4) **retention tiers** (raw events briefly, aggregates longer); (5) **cost attribution** by `team` so the spend is visible to whoever creates it. The principle: cut *boring* data, not *failure fidelity*.

> 🎯 **What's really being tested:** Cost governance as a design problem, and the discipline not to cut the fidelity you'll need (cross-ref [telemetry-cost](../telemetry-cost-and-sampling-strategy/)).

### Q: An org has logs, metrics, and traces but resolves incidents slowly. Where do you take them?

Diagnose maturity: they're likely at "structured but siloed" (level 2). The leap is correlation then ad-hoc query: (1) shared `trace_id` across all signals; (2) exemplars (metric→trace) and `trace_id` in logs (trace→log); (3) widen the spans with business attributes so you can `group by` the dimensions incidents correlate with; (4) make debugging-in-prod a routine habit (ODD), not a panic move. Measure success by *time-to-corner-a-novel-incident*, not dashboard count.

> 🎯 **What's really being tested:** Diagnosing where an org sits and sequencing the investment — the professional/leadership angle.

---

## Behavioral / Experience

### Q: Tell me about a time observability let you debug something you couldn't have otherwise.

Structure with the loop: the symptom (a customer report no dashboard showed), the hypothesis, the *query* you ran (which high-cardinality field you sliced by), how you narrowed (each `group by` halving the suspect space), the cause, and the confirmation — emphasising that it took minutes and *no new instrumentation*. Then the lesson: which attribute made it possible, or which missing attribute you added afterward.

> 🎯 **What's really being tested:** Whether you've actually used observability as a *method*, not just stared at dashboards. The "no redeploy" detail is the tell.

### Q: Tell me about an instrumentation decision you got wrong.

Good answers: a high-cardinality label that took down the TSDB; head sampling that ate the errors during an incident; an SLI measured server-side that stayed green while users suffered; PII that leaked to a backend. Show what you learned and the guardrail you added (cardinality budget, tail sampling, journey-level SLO, gateway redaction).

> 🎯 **What's really being tested:** Reflection and the irreversibility lesson — that instrumentation mistakes are expensive because they're discovered during incidents.

### Q: How have you driven observability adoption on a team or org?

Talk about paved roads (shared SDK/agent config, golden dashboards, SLO templates) over mandates, making rich instrumentation the easy path, normalising prod debugging, and measuring adoption *behaviourally* (do engineers query the tool to answer questions?) rather than by coverage percentages — and watching for the Goodhart traps.

> 🎯 **What's really being tested:** That you understand adoption is cultural, and that coverage metrics get gamed.

---

## What I'd Ask a Candidate Now

A compact battery that separates levels fast:

1. **Monitoring vs observability in one sentence each** — then "give a question monitoring can't answer." *(Concept floor.)*
2. **"Why is `user.id` forbidden as a Prometheus label but the point of a wide event?"** — listen for write-time vs query-time aggregation. *(The core discriminator.)*
3. **"Your p99 dropped during an outage — how?"** — fast failures; split success/error latency. *(Trap.)*
4. **"You sample 1% and keep missing errors — fix it."** — tail sampling; fidelity allocation. *(Practical.)*
5. **"Design the Collector topology for tail sampling at 200 services."** — `trace_id`-stable routing to a sticky gateway. *(Staff architecture.)*
6. **"You bought a SaaS and still can't debug — why?"** — capability ≠ purchase; thin spans, no correlation, no culture. *(Maturity.)*
7. **"Design observability for a payments platform."** — full stack + PII redaction + unsampled-metrics-for-SLOs. *(Synthesis.)*
8. **"How do you measure whether your observability is good?"** — outcomes (time-to-corner-a-novel-incident), Goodhart-aware. *(Leadership.)*

What I'm grading: does the candidate reach for the **wide-event / cardinality-economics** model unprompted, do they know **why** the obvious answer to a trap is wrong, and can they **design under constraint** (cost, fidelity, cardinality, compliance) rather than recite tools?

---

## Cheat Sheet

```text
┌──────────────── OBSERVABILITY ENGINEERING — INTERVIEW CHEAT SHEET ───────────────────────────┐
│                                                                                              │
│  MONITORING = known-unknowns (predefined dashboards/alerts)                                   │
│  OBSERVABILITY = unknown-unknowns (query wide events, NO deploy). control theory; subsumes mon.│
│                                                                                              │
│  3 PILLARS = output formats. real unit = ARBITRARILY-WIDE STRUCTURED EVENT (a span).          │
│    pillars are projections: metric=group-by · trace=same trace_id · log=span event            │
│    "we have logs/metrics/traces" ≠ observable (needs CORRELATION + WIDE events)               │
│                                                                                              │
│  CARDINALITY: TSDB→1 series/value (high-card = OOM, FORBIDDEN label)                           │
│               wide-event store→1 column you filter (high-card = THE POINT). write vs query agg │
│    span NAME low-card (route template); high-card detail → ATTRIBUTES                          │
│                                                                                              │
│  OTEL = spec + SDKs + Collector. instrument ONCE, vendor-neutral, all signals share context.  │
│    traces split? → propagation (HTTP auto; queues MANUAL; B3≠W3C). exemplar = record IN-span.  │
│                                                                                              │
│  SLO: SLI = good/valid query over events (USER-perceived); error budget = 1−SLO; alert on BURN.│
│                                                                                              │
│  TRAPS: p99 dropped→fast failures (split success/error latency). 1% head sampling eats errors→ │
│         TAIL sample. error rate from sampled traces = wrong → metrics UNSAMPLED. SaaS ≠ obs.   │
│                                                                                              │
│  DESIGN: wide entry span · agent→gateway (route by trace_id) · tail sample · redact PII ·      │
│          metrics unsampled for SLOs · cut BORING data not failure fidelity                     │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Further Reading

- *Observability Engineering* — Charity Majors, Liz Fong-Jones, George Miranda (O'Reilly) — wide events, cardinality, the debugging loop, maturity.
- *Distributed Systems Observability* — Cindy Sridharan — the three-pillars framing and its limits.
- *Site Reliability Engineering* & *The Site Reliability Workbook* — Google — SLIs/SLOs/error budgets, multi-burn-rate alerting.
- *Implementing Service Level Objectives* — Alex Hidalgo — SLO practice.
- **OpenTelemetry docs** — <https://opentelemetry.io/docs/> — spec, SDKs, Collector, semantic conventions.
- The `observability-stack` and `monitoring-alerting` skills — tooling and alert design.

---

## Related Topics

- **Tiers:** [junior.md](junior.md) · [middle.md](middle.md) · [senior.md](senior.md) · [professional.md](professional.md).
- **Practice:** [tasks.md](tasks.md).

**Sibling diagnostic topics:**

- [Tracing](../tracing/) · [Metrics](../metrics/) · [Logging](../logging/) — the signals, in depth.
- [Continuous Profiling](../continuous-profiling/) — the span→profile link.
- [Telemetry Cost & Sampling Strategy](../telemetry-cost-and-sampling-strategy/) — sampling/fidelity economics.
- [Dynamic Instrumentation & eBPF](../dynamic-instrumentation-and-ebpf/) · [Crash Reporting](../crash-reporting/) · [Post-Mortem Analysis](../post-mortem-analysis/).

**Cross-roadmap links:**

- [Quality Engineering → Engineering Metrics & DORA](../../quality-engineering/engineering-metrics-and-dora/) — SLOs/error budgets and Goodhart.
- [Quality Engineering → Testing → Testing in Production](../../quality-engineering/testing/13-testing-in-production/) — observability as its prerequisite.

---
