# Observability Engineering — Hands-On Exercises

> **Topic:** [Observability Engineering Roadmap](README.md)
> **Focus:** Practical exercises that take you from "I can add a `trace_id` to a log line" to "I can design the wide-event data model, Collector topology, SLOs, and fidelity/cost strategy for a polyglot system — and corner an unknown-unknown by slicing a high-cardinality field with no redeploy."

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

You cannot learn observability from reading any more than you can learn debugging from reading. You learn it by stamping a `trace_id` onto a log and watching it correlate, by instrumenting a service and following one request across a network boundary, by wiring an OpenTelemetry Collector and changing a backend without touching app code, and — the moment it all clicks — by slicing a wide event along a high-cardinality field you almost didn't capture, and finding the *one* customer behind an incident no dashboard showed.

The exercises below are tiered. The **Warm-Up** band trains the mechanics — `trace_id` in logs, a single instrumented service, propagation across one hop — so that emitting correlated telemetry is reflex. The **Core** band is about the two things that decide whether observability helps or hurts: the **wide-event data model** (which attributes you capture) and the **correlation links** (exemplar metric→trace, trace→log, the Collector as the policy plane). The **Advanced** band drops you into the situations that separate middle from senior engineers — designing SLIs/SLOs to an error budget, tail sampling for fidelity, and the signature move of the discipline: **debugging an unknown-unknown by `group by` on a high-cardinality field**. The **Capstone** stops being about one service and becomes strategy: design observability for a polyglot system end to end — data model, agent/gateway topology, backends, SLOs, cost governance, and the adoption plan.

Do not skip ahead. The Capstone assumes you can instrument a service with OTel without looking it up, that you instinctively put the route *template* in a span name and the ID in an *attribute*, and that you know why an SLI computed from sampled traces is wrong. Work each band end-to-end; if a task takes more than the stated time, write down what blocked you — that note tells you which level doc to re-read. For background at each level: [junior.md](junior.md), [middle.md](middle.md), [senior.md](senior.md), [professional.md](professional.md), and [interview.md](interview.md).

A note on tooling. You need an OTel SDK for one language (`go.opentelemetry.io/otel`, `opentelemetry-sdk` for Python, the OTel Java agent, or `@opentelemetry/sdk-node`), an **OpenTelemetry Collector** binary, and a backend that supports traces + exemplars — the easiest local stack is **Grafana + Tempo + Prometheus + Loki** (the `docker-compose` from the OpenTelemetry demo, or Grafana's OTel LGTM image), or a free Honeycomb account for the wide-event tasks. Everything here runs on a laptop with Docker. See the `observability-stack` and `monitoring-alerting` skills for tooling and alert-design depth.

---

## Warm-Up

These are 20-to-40-minute exercises. The goal is fluency with the mechanics — correlate, instrument, propagate — not insight. If a Warm-Up task takes more than an hour, stop and re-read the corresponding section of [junior.md](junior.md) or [middle.md](middle.md).

### Task 1: Sort ten questions into monitoring vs observability

**Problem.** For each question below, decide whether a **monitoring** setup (predefined dashboard/alert) or **observability** (ad-hoc query of rich telemetry) answers it, and say in one clause why.

```
1.  Is the overall error rate above 1%?
2.  Why are checkouts failing only for enterprise customers since the 14:02 deploy?
3.  Is CPU on the payments host above 90%?
4.  Which build version is responsible for the latency spike in eu-west?
5.  Is the message queue backing up?
6.  Why did THIS specific customer's order #88142 time out at 14:03?
7.  Are we within our 99.9% checkout SLO this month?
8.  Which combination of payment provider and region correlates with the new 500s?
```

**Constraints.**
- No answer may be "both" — commit to the *primary* tool and defend it.
- For each observability answer, name the high-cardinality field you'd `group by`.

**Hints.**
- Known-unknown ("is X over a threshold?") → monitoring. Unknown-unknown ("why is *this* broken in a way I didn't predict?") → observability.
- If answering needs a dimension nobody pre-aggregated, it's observability.

**Self-check.**
- [ ] #1, #3, #5, #7 are monitoring; #2, #4, #6, #8 are observability.
- [ ] For #2 you named `customer.plan` + `build.version`; for #6, `order.id`/`account.id`; for #8, `payment.provider` + `region`.
- [ ] You can state the control-theory definition of observability in one sentence.

### Task 2: Add `trace_id` and `span_id` to structured logs

**Problem.** Take any service with structured (JSON) logging. Add a logging hook/filter that stamps the current `trace_id` and `span_id` from the active OTel context onto every log line. Emit a request, confirm the log line carries the IDs, and confirm they match the IDs on the corresponding span.

**Constraints.**
- The `trace_id` must be the standard **32 hex chars**, `span_id` **16 hex chars** — the format your backend expects.
- When there is no active span, the fields must be empty strings, not a crash or a garbage value.
- Use the OTel context to read the IDs; do not pass them manually through your call stack.

**Hints.**
- Go/Python: read `trace.SpanFromContext(ctx)` / `trace.get_current_span()`; format the IDs as hex.
- A format mismatch (wrong length/case) makes the trace↔log join silently return nothing — verify the exact string.

**Self-check.**
- [ ] A log line during a request shows `"trace_id":"<32hex>","span_id":"<16hex>"`.
- [ ] The same `trace_id` appears on the span in your tracing backend.
- [ ] A log line outside any span shows empty IDs, not an error.

### Task 3: Instrument a single service with the OTel SDK

**Problem.** Take a small HTTP service. Initialise the OTel SDK (tracer provider, OTLP exporter, resource attributes), turn on HTTP auto-instrumentation, and add **one manual span** around a meaningful business operation with at least three business attributes. Export to a local Collector or backend and view the trace.

**Constraints.**
- Set resource attributes: `service.name`, `service.version`, `deployment.environment`.
- The manual span's *name* must be low-cardinality (an operation, not an ID).
- At least three attributes must be business dimensions (`customer.plan`, `cart.value`, `payment.provider`), not just framework defaults.
- The span must always `End()` (defer / context manager / try-finally) and record errors with status on the error path.

**Hints.**
- Enrich the *auto-created* request span with business attributes rather than starting a parallel one (`SpanFromContext` → `SetAttributes`).
- Use OTel semantic conventions for standard attributes; an `app.*` namespace for domain ones.

**Self-check.**
- [ ] You see the request span with your business attributes in the backend.
- [ ] Resource attributes (`service.name`/`version`/`env`) appear on every span.
- [ ] An error path produces a span with error status and a recorded error.

### Task 4: Propagate context across one hop

**Problem.** Stand up two services, A → B (HTTP). Instrument both. Confirm a single request produces **one connected trace** where B's span is a *child* of A's span. Then deliberately break propagation (disable the propagator on one side or strip the `traceparent` header) and observe the trace split into two fragments.

**Constraints.**
- Use W3C Trace Context (`traceparent`).
- The connected trace must show the correct parent/child relationship and one shared `trace_id`.
- Document *exactly* what you changed to break it and what the broken result looked like.

**Hints.**
- With OTel HTTP instrumentation on both ends, propagation is automatic — you're confirming, then breaking, it.
- A suspiciously short trace = a dropped baton. This is the #1 real-world trace failure.

**Self-check.**
- [ ] One request → one trace spanning both services, B parented to A.
- [ ] After breaking propagation, you see two separate single-service traces.
- [ ] You can explain why a queue/job hop would break the same way.

---

## Core

These are 1-to-3-hour exercises. The goal is the two things that make observability *work*: the wide-event data model and the engineered correlation links. Re-read [middle.md](middle.md) and [senior.md](senior.md) as needed.

### Task 5: Design and emit a wide structured event

**Problem.** For a checkout (or your domain's key operation), design the **wide event** — the single span carrying every dimension a future incident might need. Emit it, then verify in your backend that you can `group by` each attribute.

**Constraints.**
- Capture all four categories: **identity** (`user.id`, `account.id`, `tenant.id`), **provenance** (`build.version`, `region`, `host.name`), **business shape** (`customer.plan`, `cart.value`, `payment.provider`, a feature flag), and **mechanics** (`retry.count`, `cache.hit`).
- For each attribute, write a one-line justification of the form *"a future incident could be explained by grouping on this because ___."* Drop any attribute that fails this test.
- The span name stays low-cardinality (route template); IDs go in attributes.

**Hints.**
- Aim for breadth: 15+ attributes on the entry span is normal for a wide event.
- If you can't name an incident an attribute would explain, it's decoration — cut it.

**Self-check.**
- [ ] One operation = one wide span with 15+ purposeful attributes.
- [ ] Every attribute has a written incident-justification.
- [ ] You confirmed you can `group by` each attribute in the backend.

### Task 6: Wire an OpenTelemetry Collector and change a backend without touching app code

**Problem.** Put a Collector between your service and your backend. Configure receivers → processors → exporters. Then prove the Collector's value: (a) add an `attributes`/`transform` processor that drops a PII field (`user.email`); (b) **switch the trace backend** (e.g. Tempo → a second backend, or add Honeycomb) by editing *only the Collector config* — no app redeploy.

**Constraints.**
- App exports OTLP to the Collector; the app must not name any concrete backend.
- The PII field must be gone from telemetry that reaches the backend (verify downstream, not just in config).
- The backend switch must require zero changes to application code.

**Hints.**
- This is the entire point of the Collector: it's the policy/governance plane.
- Verify redaction by querying the backend for the dropped field and getting nothing.

**Self-check.**
- [ ] Telemetry flows app → Collector → backend over OTLP.
- [ ] `user.email` is absent from telemetry in the backend.
- [ ] You changed/added a backend by editing only the Collector config.

### Task 7: Create an exemplar linking a metric to a trace

**Problem.** Emit a latency histogram with **exemplars** so that, in Grafana (or your backend), you can click a point on the latency heatmap/histogram and jump to *the exact trace* that produced it.

**Constraints.**
- Record the histogram observation **inside the active request span** so the SDK attaches the current `trace_id`.
- Ensure the linked trace survives (don't sample it out) — keep error/slow traces.
- Demonstrate the click-through: histogram point → the specific trace.

**Hints.**
- An exemplar recorded *outside* a span is empty — this is the #1 reason exemplars "don't work."
- In Grafana, the trace backend (Tempo) must be a data source for the link to resolve.

**Self-check.**
- [ ] Histogram data points carry a `trace_id` exemplar.
- [ ] Clicking a spike lands you on a real trace in that bucket.
- [ ] You can explain the two ways an exemplar ends up empty.

### Task 8: Build the full correlation chain

**Problem.** On one request, demonstrate the complete chain: a **metric** spike → (exemplar) → the **trace** → (`trace_id`) → its **logs** → (ideally) → a **profile** of the slow span. Document each arrow and how you wired it.

**Constraints.**
- Each link must be a real click-through/query, not "they happened around the same time."
- `trace_id` must correlate logs (Task 2) and exemplars must link the metric (Task 7).
- If you can't wire span→profile locally, describe precisely what a span-aware profiler would need (the active `span_id` on samples) — cross-ref [continuous-profiling](../continuous-profiling/).

**Hints.**
- Build every link *before* you need it; teams that debug in minutes pre-wired all four.
- Loki/Tempo/Prometheus in Grafana give you metric→trace→log out of the box once IDs match.

**Self-check.**
- [ ] Metric spike → exemplar → trace works.
- [ ] Trace → logs (matching `trace_id`) works.
- [ ] You documented each arrow and its enabling configuration.

---

## Advanced

These are half-day-to-day exercises. They are where middle becomes senior: SLOs to a budget, fidelity allocation, and the signature debugging move. Re-read [senior.md](senior.md) and [professional.md](professional.md).

### Task 9: Design SLIs and SLOs for a service

**Problem.** For a real service, define a **user-perceived SLI** as a query over your telemetry, set an **SLO** and compute the **error budget**, then configure a **burn-rate alert**. Split duration by success/error so a fast failure can't flatter the percentile.

**Constraints.**
- The SLI must measure request-level user-perceived success (e.g. `status < 500 AND latency < 300ms`), *not* a server-side resource metric.
- Compute the SLI from **unsampled metrics**, never from sampled traces — and explain why.
- Alert on **multi-window burn rate**, not a raw threshold; state the consequence (error-budget policy).
- Write out the budget for your SLO/window (e.g. 99.9% over 28d ≈ 40 min).

**Hints.**
- "CPU < 80%" is not an SLI; "checkout p99 < 300ms" is.
- A flood of fast 500s drags overall p99 *down* — split duration by status class.

**Self-check.**
- [ ] SLI is a user-perceived good/valid ratio, expressed as a query.
- [ ] You computed the error budget in minutes for your window.
- [ ] The alert is burn-rate based with a stated policy, and SLIs come from unsampled metrics.

### Task 10: Configure tail sampling for fidelity

**Problem.** Configure **tail sampling** in the Collector so you retain 100% of errors and slow traces (and one high-value cohort) while sampling the boring fast majority. Generate mixed traffic and verify the retention.

**Constraints.**
- Policies must keep: all `ERROR` traces, all traces over a latency threshold, and all traces for one key attribute value (e.g. `customer.plan = enterprise`); sample the rest at a low percentage.
- Demonstrate that an error injected during a low-sample window is *still retained*.
- State the topology constraint that makes tail sampling work (whole trace on one Collector instance) even if you run a single Collector locally.

**Hints.**
- Naïve 1% head sampling would drop ~99% of your errors — that's the failure you're fixing.
- Tail sampling buffers whole traces (`decision_wait`); long traces pin memory.

**Self-check.**
- [ ] Errors and slow traces are retained at ~100% regardless of the base sample rate.
- [ ] The key-tenant policy retains that cohort.
- [ ] You can explain why spans must route by `trace_id` to one instance for tail sampling.

### Task 11: Debug an unknown-unknown by slicing a high-cardinality field

**Problem.** This is the signature exercise of the discipline. Set up (or reuse) a service whose wide events carry high-cardinality fields. Inject a **narrow failure** — e.g. requests fail *only* when `payment.provider = "stripe-v2"` AND `build.version = "4.2.1"`, at a rate low enough (≈0.3%) that no top-level dashboard or SLO fires. Then, starting *only* from a "customer reports failures" symptom, **corner the cause with queries** — no new instrumentation, no redeploy.

**Constraints.**
- The overall error rate must stay below your SLO threshold so monitoring does *not* page — the point is that observability finds what monitoring can't.
- You must isolate the cause using `group by` on high-cardinality attributes, then narrow to the affected cohort/customer.
- Record the sequence of queries (hypothesis → query → narrow → repeat → confirm) and the time it took.
- Then prove the negative: try to answer the same question using only pre-aggregated metrics with no high-cardinality labels, and show you *cannot*.

**Hints.**
- Start broad (`group by build.version, payment.provider WHERE status >= 500`), then filter to one `account.id`.
- The whole exercise only works because the fields were captured — connect this back to Task 5.

**Self-check.**
- [ ] No alert fired, yet you isolated the exact `(provider, build)` combination by query.
- [ ] You narrowed to the affected customer(s) via a high-cardinality filter.
- [ ] You demonstrated the metrics-only approach *cannot* answer it, and explained why (write-time aggregation discarded the dimension).

### Task 12: Reproduce a cardinality explosion and resolve it correctly

**Problem.** Add a high-cardinality label (`user_id`) to a Prometheus metric and watch the series count (and memory) explode. Then resolve it *correctly* — move the high-cardinality dimension to the **span/event**, keep the metric low-cardinality, and confirm you can *still* slice to one user via the wide event.

**Constraints.**
- Show the before/after series count (e.g. via `count({__name__=~"..."})` or the TSDB stats).
- The fix must preserve the ability to answer "what happened for user 88142" — via the event store, not the metric.
- Write one sentence explaining why the *same* `user_id` is a killer as a metric label and a superpower as an event attribute (write-time vs query-time aggregation).

**Hints.**
- TSDB cost ≈ product of label cardinalities; one user-id label = one series per user.
- The wide-event store has no per-combination series — `user.id` is just a filterable column.

**Self-check.**
- [ ] You observed the series-count blow-up with the `user_id` label.
- [ ] After the fix, metric series are bounded *and* you can still slice to one user via the event.
- [ ] You can articulate the write-time vs query-time aggregation distinction.

---

## Capstone

A multi-day project. This is where you stop instrumenting one service and start designing observability as a system and a strategy.

### Task 13: Design an observability strategy for a polyglot system

**Problem.** Design end-to-end observability for a realistic polyglot system: a gateway (Node), a core service (Go), a payments service (Java), and an async worker (Python) consuming a queue, all on Kubernetes. Produce a written design *and* a working slice (at least: all four services traced with propagation across the queue hop, a Collector tier, one backend, one SLO, and one demonstrated cross-service debug).

**Constraints.**
- **Data model.** Define the wide-event attribute standard every service must emit (identity, provenance, business shape, mechanics) and the naming/semantic-convention rules. Show context propagating across the **async queue** hop (inject/extract into message headers) — the place traces break.
- **Pipeline topology.** Specify **agent** Collectors (per-node, enrich, route by `trace_id`) and a **gateway** tier (tail sampling, PII redaction as a single chokepoint, span→metrics, routing). Explain why tail sampling forces `trace_id`-stable routing to a sticky gateway replica.
- **Backends & build-vs-buy.** Choose backends per signal (e.g. unsampled metrics in Prometheus, tail-sampled traces in Tempo or Honeycomb, logs in Loki) and justify the build-vs-buy call. Explain how OTel keeps the choice reversible/per-signal.
- **SLOs.** Define at least one **journey-level** SLO (e.g. "payment authorised within 2s") spanning multiple services, with a burn-rate alert and an error-budget policy with teeth.
- **Cost governance.** State the fidelity/cost plan: metrics unsampled, traces tail-sampled, cardinality budgets, attribute pruning, retention tiers, cost attribution by `team`. State the rule: cut boring data, not failure fidelity (cross-ref [telemetry-cost](../telemetry-cost-and-sampling-strategy/)).
- **Adoption & maturity.** Place the org on the maturity model, name the next leap, and give the paved-road plan (shared SDK/agent config, golden dashboards, SLO templates) plus how you'd measure adoption by *outcome* (time-to-corner-a-novel-incident) and resist Goodhart.
- **Demonstration.** Inject a cross-service failure and corner it via the debugging loop, showing the trace crossing all four services including the queue.

**Hints.**
- Reuse Tasks 4–11: this capstone is them composed into one coherent system.
- The two facts that mark a senior design: metrics unsampled (for SLOs) while traces are tail-sampled, and `trace_id`-stable routing for tail sampling.
- The OpenTelemetry demo repo is a good base polyglot system to extend.

**Self-check.**
- [ ] A single request produces one trace across all four services, including the queue hop.
- [ ] The design specifies agent/gateway topology and explains the tail-sampling routing constraint.
- [ ] You have a journey-level SLO with a burn-rate alert and an error-budget policy.
- [ ] The cost plan keeps metrics unsampled and tail-samples traces; PII is redacted at one chokepoint.
- [ ] You placed the org on the maturity model and defined an outcome-based adoption metric.
- [ ] You demonstrated cornering a cross-service unknown-unknown by query, no redeploy.

### Task 14 (Stretch): Write the observability governance doc

**Problem.** Write the one-page standard the next engineer follows: the required wide-event attributes, span-naming rules, the cardinality budget, the SLO/SLI definition language, the sampling/fidelity policy, the PII-redaction rule, and the cost-attribution scheme. Then have someone else instrument a new service from your doc alone.

**Constraints.**
- It must be prescriptive enough that a new service is observable *and* cost-governed without you in the room.
- Include the three things people get wrong: high-cardinality on labels, head sampling that eats errors, server-side SLIs.
- Include how observability success is measured (outcomes) and the Goodhart traps to avoid.

**Hints.**
- A good governance doc is paved-road, not mandate — make the right thing the easy thing.
- The test of the doc is whether a stranger produces a wide, correlated, cost-governed service from it.

**Self-check.**
- [ ] A new service instrumented from the doc alone is observable and cost-governed.
- [ ] The doc names the three classic mistakes and how to avoid them.
- [ ] Success is defined by outcomes, with explicit Goodhart guardrails.

---

## Related Topics

- **Tiers:** [junior.md](junior.md) · [middle.md](middle.md) · [senior.md](senior.md) · [professional.md](professional.md).
- **Interview prep:** [interview.md](interview.md).

**Sibling diagnostic topics:**

- [Tracing](../tracing/) · [Metrics](../metrics/) · [Logging](../logging/) — practice the individual signals.
- [Continuous Profiling](../continuous-profiling/) — the span→profile link (Task 8).
- [Telemetry Cost & Sampling Strategy](../telemetry-cost-and-sampling-strategy/) — fidelity/cost (Tasks 10, 13).
- [Dynamic Instrumentation & eBPF](../dynamic-instrumentation-and-ebpf/) — observing without code changes.
- [Crash Reporting](../crash-reporting/) · [Post-Mortem Analysis](../post-mortem-analysis/) — incident follow-through.

**Cross-roadmap links:**

- [Quality Engineering → Engineering Metrics & DORA](../../quality-engineering/engineering-metrics-and-dora/) — SLOs/error budgets and Goodhart (Tasks 9, 13).
- [Quality Engineering → Testing → Testing in Production](../../quality-engineering/testing/13-testing-in-production/) — observability as its prerequisite.

---
