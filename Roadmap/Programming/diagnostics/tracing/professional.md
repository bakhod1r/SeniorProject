# Tracing — Professional (Staff / Principal) Level

> **Topic:** [Tracing Roadmap](README.md)
> **Focus:** Tracing as an *organizational platform*, not a per-service feature. The OpenTelemetry architecture end-to-end (SDK → Collector → backend) as a system you operate and version. Tail-sampling as a distributed-systems design problem. Baggage as a governed, security-sensitive channel. Context propagation across every async runtime, thread pool, and message broker — written as library code other teams depend on. Exemplars wiring metrics to traces. Cardinality and cost as a budget you enforce. And the hardest part: building instrumentation *standards* and *auto-instrumentation* a 500-engineer org actually follows.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [The OpenTelemetry Architecture End-to-End](#the-opentelemetry-architecture-end-to-end)
6. [The Collector as the Control Plane](#the-collector-as-the-control-plane)
7. [Tail-Sampling Design and Trade-offs](#tail-sampling-design-and-trade-offs)
8. [Baggage — The Governed, Dangerous Channel](#baggage--the-governed-dangerous-channel)
9. [Context Propagation Across the Hard Boundaries](#context-propagation-across-the-hard-boundaries)
10. [Exemplars — Linking Metrics to Traces](#exemplars--linking-metrics-to-traces)
11. [Cardinality and Cost Control as a Budget](#cardinality-and-cost-control-as-a-budget)
12. [Building Org-Wide Instrumentation Standards](#building-org-wide-instrumentation-standards)
13. [Auto-Instrumentation at Fleet Scale](#auto-instrumentation-at-fleet-scale)
14. [Code Examples](#code-examples)
15. [Real Failure Stories](#real-failure-stories)
16. [Mental Models](#mental-models)
17. [Pros & Cons](#pros--cons)
18. [Use Cases](#use-cases)
19. [Coding Patterns](#coding-patterns)
20. [Clean Code](#clean-code)
21. [Best Practices](#best-practices)
22. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
23. [Common Mistakes](#common-mistakes)
24. [Tricky Points](#tricky-points)
25. [Anti-Patterns at Professional Level](#anti-patterns-at-professional-level)
26. [A Worked Rollout — Standardizing Tracing Across 200 Services](#a-worked-rollout--standardizing-tracing-across-200-services)
27. [Test Yourself](#test-yourself)
28. [Tricky Questions](#tricky-questions)
29. [Cheat Sheet](#cheat-sheet)
30. [Summary](#summary)
31. [What You Can Build](#what-you-can-build)
32. [Further Reading](#further-reading)
33. [Related Topics](#related-topics)
34. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

> 🎓 At the professional level, tracing stops being a thing *you* configure and becomes a thing *the org runs*. The question is no longer "how do I sample this service?" — it is "how does a 500-engineer organization get **consistent, affordable, propagation-correct, privacy-safe** traces across 300 services in five languages, without me reviewing every PR?"

Senior taught the *economics and engineering under constraint* of one service or one team's fleet: head vs tail sampling, the overhead budget, span granularity, propagation across async and queues, semantic conventions as a contract. That knowledge is the prerequisite, not the topic. This file does not re-derive what a tail sampler is or why `ParentBased` matters — go read [`senior.md`](senior.md) if those are fuzzy.

The staff/principal move is from *configuring* tracing to *owning the platform*. The OpenTelemetry pipeline — SDK, Collector, backend — is a distributed system you operate, version, capacity-plan, and fail over. Tail sampling is not a YAML stanza; it is a stateful, sharded, memory-bound tier whose topology is a design decision with availability and correctness consequences. Baggage is not "free context" — it is an unbounded, security-sensitive header channel that, ungoverned, leaks PII and bloats every hop in your mesh. Exemplars are the wiring that turns three disconnected pillars (logs, metrics, traces) into one navigable surface. And the genuinely hard part — the part that distinguishes a staff engineer from a very good senior — is the *human* system: instrumentation standards a hundred teams follow, auto-instrumentation that gives correct traces by default, and a deprecation process for semantic conventions that doesn't silently break every dashboard in the company.

> If `junior.md` is "create a span," `middle.md` is "keep the trace whole across services," and `senior.md` is "what can I afford to keep and where does context die," then `professional.md` is "**make correct, affordable, safe tracing the path of least resistance for every engineer in the company — and operate the pipeline that makes it true.**"

The reference frame here is the people who built this: Yuri Shkuro (Jaeger, *Mastering Distributed Tracing*), the OpenTelemetry spec authors, the teams at Google (Dapper), Uber, Lightstep/ServiceNow, Honeycomb, and Grafana who run trace pipelines at millions of spans per second. Everything below is downstream of operating tracing as a tier-0 platform.

---

## Prerequisites

- **Required:** All of [`senior.md`](senior.md) — head/tail sampling, `ParentBased`, `TraceIdRatioBased` consistency, the overhead budget, span granularity, async/queue propagation mechanics, semconv-as-contract, the `SpanProcessor`/Collector pipeline shape.
- **Required:** You have operated an OpenTelemetry Collector in production — not just configured one, but watched it OOM, scaled it, and debugged a dropped-spans incident.
- **Required:** You understand the difference between a metric, a log, and a span at the *storage and query cost* level (see [`../metrics/senior.md`](../metrics/senior.md) and [`../logging/professional.md`](../logging/professional.md)).
- **Required:** Deep familiarity with at least two of the runtimes covered here (Go scheduler, JVM thread model, Python `asyncio`/`contextvars`, Node `async_hooks`, Rust `tokio`) — you'll be writing propagation library code others depend on.
- **Helpful:** You've been the person a team escalates to when "the trace stops" or "the bill tripled." This file is the systematization of that experience.
- **Helpful:** Org-level influence — you can drive a standard across teams that don't report to you. The technical content here is half the job; adoption is the other half.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Control plane / data plane** | The data plane is the high-volume span traffic (SDK → Collector → backend). The control plane is the configuration, sampling policy, and standards that govern it — increasingly delivered via OpAMP. |
| **OpAMP** | Open Agent Management Protocol — the OTel standard for remotely configuring and updating a fleet of Collectors/agents from a central server. The control plane for the data plane. |
| **Agent vs gateway Collector** | *Agent*: a Collector per node/pod (sidecar or DaemonSet), close to the app, does cheap local work. *Gateway*: a horizontally-scaled Collector tier that does heavy stateful work (tail sampling, fan-out). |
| **Consistent probability sampling (`r`/`th`)** | The W3C `tracestate` mechanism (`ot=th:<threshold>;rv:<random>`) that lets heterogeneous SDKs and the Collector make the *same* probabilistic keep/drop decision and even *re-sample down* without breaking consistency. |
| **Probabilistic sampler processor** | The Collector processor that implements consistent probability sampling using the `r`-value, so you can sample in the gateway without the per-trace partiality of naive percentage sampling. |
| **Adaptive sampling** | Sampling whose rate is adjusted dynamically per-endpoint/per-operation to hit a target spans/sec, giving rare operations more coverage than hot ones. Jaeger's remote sampler is the canonical implementation. |
| **Remote sampling** | The SDK fetches its sampling configuration from a central service (Jaeger `jaeger-agent`/collector strategies, or OpAMP) instead of hard-coding it. |
| **Exemplar** | A sampled trace ID (plus its timestamp and label set) attached to a metric data point, so a metric spike is a clickable link to a representative trace. A first-class OTLP metrics feature. |
| **Baggage** | The W3C `baggage` header — arbitrary key-value pairs propagated alongside `traceparent` to *every* downstream service. Powerful and dangerous: unbounded, plaintext, and trusted across boundaries. |
| **`SpanProcessor` chain** | Multiple processors per provider; e.g. a `BatchSpanProcessor` plus a custom processor that enriches or redacts on `OnEnd`. |
| **Span limits** | SDK caps on attributes/events/links per span and value length (`OTEL_SPAN_ATTRIBUTE_COUNT_LIMIT`, etc.). Truncation is silent; bound proactively. |
| **Resource detector** | SDK component that auto-populates `Resource` attributes (`k8s.pod.name`, `cloud.region`, `host.id`) from the environment. |
| **`Sampler` vs sampling processor** | The *SDK* `Sampler` is head sampling (per root span). The *Collector* `tail_sampling`/`probabilistic`/`groupbytrace` processors are pipeline-stage sampling. Different layers, different state. |
| **`groupbytrace` processor** | Collector processor that buffers and re-assembles all spans of a trace ID before passing them as a unit to `tail_sampling`. The buffering tier. |
| **`loadbalancing` exporter** | Collector exporter that routes spans to a downstream Collector chosen by a hash of the trace ID — the mechanism that makes a sharded tail-sampling gateway see whole traces. |
| **Schema URL / schema transformation** | The OTel `schema_url` mechanism that versions semantic conventions and enables automated migration of old attribute names to new ones. |
| **Span metrics (`spanmetrics` connector)** | A Collector connector that derives RED metrics (Rate/Errors/Duration) from spans, so you get metrics for free from traces — with their own cardinality risks. |
| **Tenant isolation** | Keeping one team's/customer's trace volume from starving another's in a shared Collector/backend (rate limits, per-tenant pipelines). |

---

## Core Concepts

### 1. The Collector is the control plane; the app should be dumb

The single most important architectural stance at this level: **the application's tracing config should be nearly empty.** It emits 100% (or a high ratio) of spans as OTLP to `localhost:4317` and does nothing else — no tail sampling, no redaction, no enrichment, no backend-specific knowledge, no per-team sampling policy. *Everything* configurable lives in the Collector, which you update centrally (ideally via OpAMP) without a single app redeploy. When a staff engineer says "we changed the sampling policy fleet-wide at 2am during an incident," they mean they pushed a Collector config — not that 300 teams shipped a release. An app that bakes in sampling rate, backend endpoint, or redaction rules has hard-coded a policy you'll need a company-wide migration to change.

### 2. Tail sampling is a sharded, stateful, memory-bound distributed system — treat it like one

Senior covered *that* tail sampling buffers traces and can OOM. Professional owns the *topology*: tail sampling only works if **every span of a trace reaches the same Collector instance**, which forces a two-tier design (a stateless routing tier hashing by trace ID, a stateful sampling tier owning trace-ID shards). That shard map is a consistent-hashing problem with rebalancing, hot-shard, and instance-death consequences. A tail-sampling gateway is a database — sized by `RPS × decision_wait × span_size`, alerted on memory and on *late spans* (spans arriving after the decision was made), and capacity-planned for the worst trace, not the average one.

### 3. Baggage is trusted, unbounded, plaintext propagation — govern it like a security boundary

`baggage` rides every hop. That means: (a) it costs bytes on every request header in your mesh — a 2KB baggage payload across a 20-hop request is 40KB of pure overhead per request; (b) it is *plaintext and trusted* — a service deep in your stack reads baggage and believes it, so an untrusted edge that injects `baggage: user.tier=premium` just escalated privilege if anyone authorizes on it; (c) it crosses *trust boundaries* — baggage set inside your perimeter can leak to a third party if you propagate to an external call. Governed baggage has an allowlist, a size cap, and a rule that it never crosses the perimeter. Ungoverned baggage is a PII leak and an SSRF-adjacent trust bug waiting to happen.

### 4. Propagation correctness is *library* work, not *application* work

At senior level you knew the mechanism for each runtime. At professional level you *write the wrapper* so application engineers can't get it wrong: a traced executor, a traced Kafka client, a context-preserving job runner — shipped as an internal library, with a CI test that fails the build if a downstream span loses the trace ID. You don't teach 200 engineers `Context.taskWrapping`; you ship them a thread pool that's already wrapped. The failure mode you're designing out is "someone used a raw `ExecutorService` and the trace silently broke" — and you design it out with code, not documentation.

### 5. Exemplars are the wiring that makes the three pillars one product

Metrics tell you *something* is wrong; traces tell you *which request*. Exemplars are the link: a trace ID stapled to a metric data point so a p99 spike on a Grafana panel is a click away from the actual 4-second trace. Without exemplars, an engineer reads "p99 = 4s at 14:32," then goes *hunting* for a matching slow trace — and usually the one they want wasn't sampled. With exemplars, the metric *hands them* a trace that was. This is the single highest-leverage integration in observability, and at this level you're responsible for making sure your histograms emit exemplars and your sampling keeps the exemplar's trace.

### 6. Cardinality and cost are a budget you *enforce in the pipeline*, not a guideline you *hope teams follow*

Span attributes don't multiply storage the way metric labels do — but the trace backend *indexes* them, and an unbounded high-cardinality attribute (a full URL with query string, a serialized request body) blows up index size and query cost, and the `spanmetrics` connector turns a high-cardinality span attribute into a high-cardinality *metric*, which absolutely does explode. At fleet scale you don't *ask* teams to be careful; you put a cardinality limiter and an attribute allowlist *in the Collector*, so a team that ships `http.target=/users/12345?token=abc` gets it normalized or dropped before it costs you.

### 7. Standards only work if the correct thing is the *default* thing

A 40-page "instrumentation guidelines" wiki page is theater. Engineers follow the path of least resistance. So the standard is *enforced by tooling*: a shared bootstrap library that wires the right sampler/processor/propagators, auto-instrumentation that produces semconv-correct spans with zero app code, a CI linter that fails on deprecated attribute names, and a default Collector config that redacts and bounds. The standard is *code and config*, not prose. If doing the right thing requires reading docs, most engineers will do the wrong thing.

---

## The OpenTelemetry Architecture End-to-End

The full picture, every box owned by you at this level:

```text
┌─ APPLICATION (dumb) ──────────────────────────────────────────────────────────┐
│  TracerProvider                                                                 │
│    Resource (service.name, version, k8s.*, cloud.* via detectors)               │
│    Sampler:  ParentBased(AlwaysOn)  ← export everything; Collector decides       │
│    SpanProcessor: BatchSpanProcessor (bounded queue, async export)              │
│    Propagators: TraceContext + Baggage (composite)                              │
│    Exporter: OTLP/gRPC → localhost:4317                                          │
└──────────────────────────────┬──────────────────────────────────────────────────┘
                               │ OTLP (gRPC/HTTP), one hop, localhost
                               ▼
┌─ AGENT COLLECTOR (per node / DaemonSet / sidecar) ────────────────────────────┐
│  receivers:  [otlp]                                                             │
│  processors: [memory_limiter, k8sattributes(enrich), attributes(redact),       │
│               batch]                                                            │
│  exporters:  [loadbalancing → gateway tier, routed by trace-id]                │
└──────────────────────────────┬──────────────────────────────────────────────────┘
                               │ trace-id-hashed routing (whole trace → one gateway)
                               ▼
┌─ GATEWAY COLLECTOR (horizontally scaled, STATEFUL) ───────────────────────────┐
│  processors: [groupbytrace(buffer whole trace), tail_sampling(policies),       │
│               batch]                                                            │
│  connectors: [spanmetrics → RED metrics to Prometheus]                          │
│  exporters:  [otlp/tempo, otlp/datadog, prometheus]   ← multi-backend fan-out   │
└──────────────────────────────┬──────────────────────────────────────────────────┘
                               ▼
                   Backend (Tempo / Jaeger / Datadog / Honeycomb)
                   + Metrics backend (Prometheus/Mimir) fed by spanmetrics
   Control plane (OpAMP): push config to ALL collectors centrally, no app redeploy.
```

### Why three tiers, not one

| Tier | Stateless? | Job | Why it's separate |
|---|---|---|---|
| **SDK (app)** | Yes | Create spans, export 100% to localhost | Apps must stay dumb so policy changes don't require redeploys |
| **Agent** | Yes | Enrich (k8s/host), redact PII, batch, route by trace-id | Cheap per-node work; offloads the app; one place to strip secrets |
| **Gateway** | **No** | Buffer whole traces, tail-sample, derive span metrics, fan out to backends | Stateful + memory-heavy; must be scaled and operated independently of apps |

The reason you don't tail-sample in the agent: the agent only sees the spans from *its* node, never the whole trace. Tail sampling *needs* the whole trace, which only exists after the `loadbalancing` exporter routes every span of a trace ID to one gateway instance. Collapsing tiers either breaks tail sampling (agent can't see whole traces) or couples app deploys to pipeline ops (no separation).

### The OTLP contract

OTLP (OpenTelemetry Protocol) is the wire format and the decoupling point. Apps speak OTLP; the Collector speaks OTLP in and *anything* out (Jaeger, Zipkin, Datadog, vendor). This is why "swap the backend without touching apps" is real: the app's contract is OTLP-to-localhost, full stop. Standardize on **OTLP/gRPC for intra-cluster** (efficient, streaming) and keep OTLP/HTTP as the fallback for environments where gRPC is awkward (some serverless, some browser/RUM paths).

---

## The Collector as the Control Plane

The Collector is where staff-level tracing lives. Its config *is* your tracing policy.

### Processor order is load-bearing

Processors run in the order listed. Get it wrong and you redact too late, batch before enriching, or run out of memory before the limiter engages.

```yaml
# Agent collector — order matters, top to bottom.
processors:
  memory_limiter:                 # FIRST — shed before OOM, protects everything after it
    check_interval: 1s
    limit_percentage: 80
    spike_limit_percentage: 25
  k8sattributes:                  # enrich while we still have the pod's identity
    extract:
      metadata: [k8s.pod.name, k8s.namespace.name, k8s.node.name, k8s.deployment.name]
  attributes/redact:              # redact BEFORE export — secrets must never leave the node
    actions:
      - { key: http.request.header.authorization, action: delete }
      - { key: http.request.header.cookie,        action: delete }
      - { key: url.query,                          action: delete }   # query strings hide tokens
      - { key: db.query.text,                      action: hash }     # keep shape, lose values
  attributes/normalize:           # cardinality control — template the route, drop raw IDs
    actions:
      - { key: http.route, pattern: '/users/[0-9]+', action: extract, value: '/users/{id}' }
  batch:                          # LAST — batch right before export for efficiency
    timeout: 5s
    send_batch_size: 8192
    send_batch_max_size: 16384
```

> **`memory_limiter` first, `batch` last** is doctrine. The limiter is your circuit breaker against OOM — it must run before any processor that buffers. `batch` accumulates, so it runs last, right before the exporter. Redaction runs before export because *the agent is the last place you control before bytes leave the node*.

### Multi-backend fan-out and migration

The Collector lets you send the same traces to two backends at once — the mechanism behind a zero-downtime backend migration (e.g. Jaeger → Tempo, or self-hosted → Datadog):

```yaml
exporters:
  otlp/tempo:    { endpoint: tempo:4317,    tls: { insecure: true } }
  otlp/datadog:  { endpoint: datadog-agent:4317 }
service:
  pipelines:
    traces:
      receivers:  [otlp]
      processors: [memory_limiter, tail_sampling, batch]
      exporters:  [otlp/tempo, otlp/datadog]   # dual-write during migration; drop one when confident
```

### OpAMP — config as a control plane

Editing YAML and rolling Collectors by hand across hundreds of nodes is not a fleet strategy. **OpAMP** (Open Agent Management Protocol) lets a central server push config, sampling policy, and even Collector binary updates to every agent, with health reporting back. This is what makes "change tail-sampling policy fleet-wide in one action" true. At professional scale, your Collector fleet is managed by an OpAMP control plane (Grafana Alloy, the OTel Operator, or a vendor's), not by `kubectl edit` on 400 DaemonSet pods.

### Resilience: the Collector is on the critical path of your observability, not your product

A core stance: **the Collector must fail in a way that loses telemetry, never the user's request.** Apps export async (BatchSpanProcessor) and drop on full queue. The Collector itself uses `memory_limiter` to shed, `sending_queue` with bounded retry to absorb backend blips, and is deployed redundantly. But you also alert on it: Collector memory, refused spans, export failures, and *queue saturation* are tier-0 signals. A blind tracing pipeline during an incident is worse than no pipeline, because you'll *think* you have data.

---

## Tail-Sampling Design and Trade-offs

Senior established what tail sampling is and that it can OOM. Professional is about *designing the tier* and *choosing policies that compose correctly*.

### The two-tier topology in detail

```text
   apps (export 100%)
        │ OTLP
        ▼
   ┌─ TIER 1: routing collectors (stateless, scale freely) ─┐
   │   loadbalancing exporter:                               │
   │     routing_key: traceID                                │
   │     resolver: dns / k8s  → list of tier-2 instances     │
   └──────────────┬──────────────────────────────────────────┘
        consistent-hash(traceID) → exactly ONE tier-2 instance
        ▼
   ┌─ TIER 2: tail-sampling collectors (STATEFUL, sharded) ─┐
   │   groupbytrace:  wait_duration, num_traces (buffer)     │
   │   tail_sampling: policies (errors, latency, baseline)   │
   │   → each instance owns a trace-id SHARD, sees WHOLE      │
   │     traces for its shard                                 │
   └──────────────┬──────────────────────────────────────────┘
        ▼  sampled traces → backend
```

The `loadbalancing` exporter's `routing_key: traceID` is the load-bearing line: it hashes the trace ID so all spans of a trace land on the same tier-2 instance. Without it, tier-2 instances see fragments and decide on partial traces — silently wrong.

### Sizing the buffer (the math that prevents OOM)

```text
   in-flight traces ≈ trace_arrival_rate × decision_wait
   buffer memory    ≈ in-flight_traces × avg_spans_per_trace × bytes_per_span
                     (× a safety factor for tail-heavy traces — the worst trace, not the average)

   Example: 20k traces/sec × 10s decision_wait = 200k in-flight traces
            × 30 spans × 1 KB = ~6 GB per gateway instance just for buffering.
   Shard across 8 instances → ~750 MB each. Set num_traces and memory_limiter accordingly.
```

The trap senior named (OOM) is prevented by *doing this math per instance*, setting `num_traces` as a hard cap, sizing `memory_limiter`, and alerting before you hit it. And critically: **size for the worst trace.** A single pathological 50,000-span trace during an incident is exactly when you need tail sampling working — and exactly when an unbounded buffer dies.

### Policy composition — OR semantics and the baseline trap

`tail_sampling` policies are OR'd: a trace is kept if *any* policy matches. The standard production set:

```yaml
tail_sampling:
  decision_wait: 10s
  num_traces: 200000              # hard memory cap — sized from the math above
  expected_new_traces_per_sec: 20000
  policies:
    - name: errors                # keep every errored trace
      type: status_code
      status_code: { status_codes: [ERROR] }
    - name: slow                  # keep every slow trace
      type: latency
      latency: { threshold_ms: 1000 }
    - name: high-value-route      # keep all checkout traffic
      type: string_attribute
      string_attribute: { key: http.route, values: ["/checkout"] }
    - name: rate-limited-baseline # 1% of everything else, but capped at N/s
      type: and
      and:
        and_sub_policy:
          - { name: prob, type: probabilistic, probabilistic: { sampling_percentage: 1 } }
          - { name: cap,  type: rate_limiting, rate_limiting: { spans_per_second: 500 } }
```

> **The baseline trap:** a naive `probabilistic` baseline scales with traffic, so a 10× spike makes your baseline 10× bigger exactly when the buffer is most stressed. Compose `probabilistic` with `rate_limiting` (an `and` policy) so the baseline is *both* a fraction *and* capped. Errors and slow traces stay unbounded-by-design (you want all of them), but the boring baseline must never run away.

### The decision-wait latency floor (and why it disqualifies tail sampling for alerting)

A trace isn't exported until `decision_wait` (e.g. 10s) after its *last* span. So your error traces land in the backend ~10s+ late. **This is fine for debugging, fatal for real-time alerting.** Never wire an alert to "error traces appeared" — alert on *metrics* (which are real-time and unsampled), then use the late-arriving traces to investigate. This is the deepest reason the three pillars are not interchangeable: metrics are for *detection*, traces are for *diagnosis*, and tail sampling structurally delays traces.

### Consistent probability sampling (`r`/`th`) — sampling *down* without breaking traces

A subtle frontier problem: if you head-sample at the app (say 10%) and then want to sample *further down* at the gateway, naive percentage sampling there would keep a different 10% of an already-sampled set — and because different SDKs and the Collector might disagree, you'd get partial traces. The W3C `tracestate` consistent-probability mechanism (`ot=th:<threshold>;rv:<random>`) carries the sampling *threshold* in `tracestate`, so any layer can re-sample *down* deterministically and every layer agrees. The Collector's `probabilistic_sampler` processor implements this. At this level you choose: tail sampling (outcome-aware, stateful) *or* consistent-probability cascade sampling (stateless, blind to outcome but composes across layers) — or a mix.

| Strategy | Stateful? | Outcome-aware? | Composes across layers? | Use when |
|---|---|---|---|---|
| **Head ratio (`ParentBased`)** | No | No | Yes (deterministic on trace-id) | Cheap baseline, no gateway needed |
| **Tail sampling** | Yes (gateway) | **Yes** | Within one gateway shard | You must keep all errors/slow |
| **Consistent probability (`r`/`th`)** | No | No | **Yes, even sampling down** | Multi-layer ratio without partial traces |
| **Adaptive / remote sampling** | Server-side | Per-operation | Yes | Rare ops need more coverage than hot ops |

---

## Baggage — The Governed, Dangerous Channel

Baggage is the most-misused OTel feature at scale. It propagates arbitrary key-values to every downstream service. The use cases are real — propagate a `tenant.id` or `experiment.variant` so deep services can attribute or branch without re-deriving it — but ungoverned baggage is three different incidents waiting to happen.

### The three baggage failure modes

| Failure mode | Mechanism | Consequence |
|---|---|---|
| **Header bloat** | Baggage rides every hop's headers. 2KB × 20 hops × every request. | 40KB/request of pure overhead; some proxies/gateways reject oversized headers and your requests start 431-ing. |
| **PII / secret leak** | Someone puts `user.email` or an auth token in baggage; it propagates *everywhere*, including to spans (auto-recorded) and potentially across the perimeter. | PII in your trace backend, searchable; secrets crossing a trust boundary. |
| **Trust escalation** | A service authorizes on a baggage value (`user.tier=premium`) that an untrusted edge can set. | Privilege escalation — baggage is *not* authenticated; never authorize on it. |

### Governance: an allowlist, a size cap, and a perimeter rule

```go
// A baggage governance propagator: allowlist keys, cap total size, never authorize on it.
// Wrap the standard Baggage propagator so application code physically cannot abuse it.
type governedBaggage struct {
    inner   propagation.Baggage
    allowed map[string]bool // e.g. {"tenant.id": true, "experiment.variant": true}
    maxLen  int             // total serialized baggage byte cap, e.g. 512
}

func (g governedBaggage) Inject(ctx context.Context, carrier propagation.TextMapCarrier) {
    b := baggage.FromContext(ctx)
    filtered, _ := baggage.New() // start empty
    total := 0
    for _, m := range b.Members() {
        if !g.allowed[m.Key()] {
            continue // drop non-allowlisted keys — they never propagate
        }
        total += len(m.Key()) + len(m.Value())
        if total > g.maxLen {
            break // hard size cap — bloat protection
        }
        filtered, _ = filtered.SetMember(m)
    }
    g.inner.Inject(baggage.ContextWithBaggage(ctx, filtered), carrier)
}
func (g governedBaggage) Extract(ctx context.Context, carrier propagation.TextMapCarrier) context.Context {
    return g.inner.Extract(ctx, carrier) // extraction is symmetric; apply the same allowlist on read at the edge
}
func (g governedBaggage) Fields() []string { return g.inner.Fields() }
```

And at the perimeter — the egress gateway or any external call — **strip baggage entirely.** Baggage is an *internal* mechanism; it must never cross to a third party (data leak) or be trusted from one (injection). The senior file flagged "baggage growth" as a pitfall; the professional discipline is a *governed propagator* that makes the safe behavior structural, plus a perimeter strip.

> **Never put in baggage:** PII, secrets/tokens, anything you'd authorize on, anything large. **Good baggage:** a low-cardinality `tenant.id`, an `experiment.variant`, a `request.priority` — small, non-sensitive, useful to deep services. When in doubt, it's an attribute on a span (stays local to the trace), not baggage (goes everywhere).

---

## Context Propagation Across the Hard Boundaries

Senior gave the per-runtime mechanism. Professional ships it as *library code* that application engineers can't get wrong, and covers the boundaries senior didn't: the message-queue *library*, the connection pool, the lambda/serverless invoke, the gRPC stream.

### The principle: wrap the primitive, don't document the wrapping

You will not get 200 engineers to remember `Context.taskWrapping` or `copy_context().run`. You ship them a traced primitive and a CI test that fails if a trace is dropped.

### Go — a traced errgroup and a traced worker pool

```go
// A drop-in traced worker pool. Application code submits work; context flows automatically.
// The bug this designs out: a goroutine started with context.Background() → orphan span.
type TracedPool struct {
    tracer trace.Tracer
    sem    chan struct{}
}

func NewTracedPool(tracer trace.Tracer, workers int) *TracedPool {
    return &TracedPool{tracer: tracer, sem: make(chan struct{}, workers)}
}

// Submit captures the CALLER's ctx (and thus active span) and runs fn under a child span.
func (p *TracedPool) Submit(ctx context.Context, name string, fn func(context.Context) error) <-chan error {
    out := make(chan error, 1)
    p.sem <- struct{}{}
    go func() {
        defer func() { <-p.sem }()
        // ctx flows in from the closure — NEVER context.Background() here.
        childCtx, span := p.tracer.Start(ctx, name)
        defer span.End()
        if err := fn(childCtx); err != nil {
            span.RecordError(err)
            span.SetStatus(codes.Error, err.Error())
            out <- err
            return
        }
        out <- nil
    }()
    return out
}
```

### Java — propagation across a connection pool / reactive boundary

The JVM agent auto-wraps most executors, but reactive (`CompletableFuture`, Reactor, `WebClient`) and pooled callbacks are where traces still die. Ship a wrapped executor and use context-capturing helpers.

```java
import io.opentelemetry.context.Context;
import java.util.concurrent.*;

// 1) A traced executor every team uses instead of raw Executors.*
ExecutorService traced = Context.taskWrapping(Executors.newFixedThreadPool(16));

// 2) CompletableFuture: capture context at the supply site, restore inside.
Context captured = Context.current();
CompletableFuture
    .supplyAsync(() -> {
        try (var scope = captured.makeCurrent()) {   // restore the calling context
            return fetchPricing();                    // spans here parent correctly
        }
    }, traced)                                        // run on the traced pool
    .thenApply(price -> {
        try (var scope = captured.makeCurrent()) {
            return enrich(price);
        }
    });
// Reactor/WebClient: rely on the agent's context propagation (contextWrite) — but TEST it,
// because a custom Scheduler or a .publishOn() can silently detach the context.
```

### Python — async + thread-pool + a process-pool reality check

`asyncio` propagates via `contextvars`; `ThreadPoolExecutor` needs `copy_context().run`; **`ProcessPoolExecutor` cannot propagate at all** (separate process, separate memory) — you must inject/extract through the process boundary like a queue.

```python
import contextvars
from concurrent.futures import ThreadPoolExecutor, ProcessPoolExecutor
from opentelemetry import trace
from opentelemetry.propagate import inject, extract

tracer = trace.get_tracer("worker")

# Thread pool: carry the context across with copy_context (senior-level, shipped as a helper).
def traced_submit(pool: ThreadPoolExecutor, fn, *args):
    ctx = contextvars.copy_context()
    return pool.submit(ctx.run, fn, *args)

# Process pool: contextvars DON'T cross processes. Serialize the context like a message.
def submit_to_process(pool: ProcessPoolExecutor, fn, payload):
    carrier = {}
    inject(carrier)                     # serialize current trace context into a dict
    return pool.submit(_run_in_process, fn, payload, carrier)

def _run_in_process(fn, payload, carrier):
    parent = extract(carrier)           # reconstruct context in the child process
    with tracer.start_as_current_span("process-work", context=parent):
        return fn(payload)
```

> **The process boundary is a queue.** `ProcessPoolExecutor`, `multiprocessing`, `fork`+exec, or shelling out to a subprocess — context does not flow through memory because there is no shared memory. Inject into a carrier, pass it across, extract on the other side. This is the same discipline as a Kafka hop. Engineers who know `copy_context().run` often forget this and ship orphaned subprocess traces.

### Node — `async_hooks` reality and the cross-`worker_threads` boundary

`AsyncLocalStorage` (built on `async_hooks`) follows promises and timers. It breaks across `worker_threads` (separate V8 isolate) and on some native-addon callbacks. Cross worker threads like a queue.

```js
const { context, propagation, trace } = require("@opentelemetry/api");
const { Worker } = require("worker_threads");

// Main thread: serialize the active context into the worker's initial data.
function runInWorker(payload) {
  const carrier = {};
  propagation.inject(context.active(), carrier);     // trace context → plain object
  return new Worker("./worker.js", { workerData: { payload, carrier } });
}

// worker.js: reconstruct the context — async_hooks does NOT cross the thread boundary.
const { workerData } = require("worker_threads");
const parent = propagation.extract(context.active(), workerData.carrier);
context.with(parent, () => {
  trace.getTracer("worker").startActiveSpan("worker-task", (span) => {
    doWork(workerData.payload);
    span.end();
  });
});
```

### Rust — `tokio::spawn`, `spawn_blocking`, and the `tracing`↔OTel bridge

In Rust the discipline is `.instrument()` on every spawned future and explicit span entry inside `spawn_blocking` (which runs on a separate blocking pool). The `tracing-opentelemetry` layer bridges `tracing` spans to OTel.

```rust
use tracing::Instrument;

async fn fan_out(items: Vec<Item>) {
    let parent = tracing::info_span!("fan_out");
    async {
        // Async tasks: attach a child span with .instrument().
        let async_handles: Vec<_> = items.iter().map(|item| {
            let sp = tracing::info_span!("process_async", id = item.id);
            tokio::spawn(process_async(item.clone()).instrument(sp))
        }).collect();

        // Blocking work runs on a SEPARATE pool — capture and re-enter the span explicitly.
        let sp = tracing::info_span!("process_blocking");
        let blocking = tokio::task::spawn_blocking(move || {
            let _enter = sp.enter();   // enter the span on the blocking thread
            heavy_cpu_work()
        });

        for h in async_handles { let _ = h.await; }
        let _ = blocking.await;
    }
    .instrument(parent)
    .await;
}
```

### The boundary catalog (what senior didn't cover)

| Boundary | Propagates by default? | Carry it across with |
|---|---|---|
| Go goroutine | No (ctx is explicit) | Pass `ctx` into the closure / a traced pool |
| Python `ProcessPoolExecutor` / `multiprocessing` | **No (separate process)** | `inject`/`extract` through a carrier dict |
| Node `worker_threads` | **No (separate isolate)** | `inject` into `workerData`, `extract` in worker |
| Rust `spawn_blocking` | No (separate pool) | `span.enter()` inside the closure |
| gRPC streaming | Per-RPC metadata only on open | Re-inject per message if the stream is long-lived |
| Lambda / serverless invoke | Only if the trigger carries it | Extract from the event (SQS/SNS/API GW carries `traceparent`) |
| Subprocess / shell-out | **No** | Pass `TRACEPARENT` as an env var; child SDK reads it |
| Connection-pool callbacks | Often not (callback reused across requests) | Re-bind context per checkout |

---

## Exemplars — Linking Metrics to Traces

Exemplars are the integration that makes the observability stack *one product*. A histogram bucket records not just "47 requests landed in the 2-4s bucket" but *a sample trace ID* of one of them. Grafana renders it as a clickable dot on the latency panel.

### How exemplars work

When you record a metric (a histogram observation) *inside an active sampled span*, the SDK attaches that span's trace ID to the metric data point as an exemplar. The contract has three load-bearing requirements:

1. **The metric must be recorded inside a sampled span's context** — no active span, no exemplar.
2. **The trace must actually be kept** — if the exemplar points to a trace your sampling dropped, the click leads nowhere. (This couples exemplar usefulness to your sampling policy: tail sampling that keeps errors/slow traces *also* keeps the traces exemplars on the slow-latency buckets point to — a nice alignment.)
3. **The backends must be wired** — Prometheus/Mimir store the exemplar, Grafana's data-source links trace ID → Tempo/Jaeger.

### Go — emitting exemplars from a histogram inside a span

```go
// The OTel metrics SDK auto-attaches the active span's trace ID as an exemplar
// when you Record inside a sampled span. The key is: record the metric WHERE the span is active.
func (s *Service) handle(ctx context.Context, req Request) {
    ctx, span := s.tracer.Start(ctx, "handle")
    defer span.End()

    start := time.Now()
    s.process(ctx, req)
    // Recording with ctx carrying the active sampled span → the data point gets an exemplar
    // (trace_id + span_id) pointing back to THIS trace.
    s.latency.Record(ctx, time.Since(start).Seconds(),
        metric.WithAttributes(attribute.String("route", req.Route)))
}
```

### Prometheus/Grafana wiring (the part teams forget)

```yaml
# Prometheus must be told to store exemplars (feature must be enabled).
# prometheus.yml
storage:
  exemplars:
    max_exemplars: 100000
# Grafana Tempo data source: link exemplar trace_id → Tempo query.
# datasource (Prometheus): exemplarTraceIdDestinations:
#   - name: trace_id
#     datasourceUid: tempo
```

> **Why this is the highest-leverage integration:** without exemplars, "p99 = 4s at 14:32" sends an engineer *hunting* for a slow trace — and they usually find that the slow request they care about wasn't sampled. With exemplars, the metric *hands them* a trace that was kept. Wire exemplars and you've connected detection (metrics) to diagnosis (traces) with a single click. This is the workflow [`../debugging/professional.md`](../debugging/professional.md) calls the biggest observability improvement of the last five years — and at this level *you're the one who wires it*.

---

## Cardinality and Cost Control as a Budget

Senior introduced that span attributes inflate the index. Professional *enforces* a budget in the pipeline.

### Where span data turns into cost

| Cost surface | What drives it | Where you control it |
|---|---|---|
| **Trace backend index** | High-cardinality searchable attributes (raw URLs, request bodies, UUIDs as keys) | Attribute allowlist + normalization in the Collector |
| **`spanmetrics` cardinality** | A high-cardinality span attribute used as a metric dimension → *metric* explosion | Restrict `spanmetrics` dimensions to low-cardinality keys only |
| **Span volume** | Granularity + sampling rate | Granularity standards + sampling policy |
| **Egress / storage / query** | Bytes/span × rate × retention | Sampling + attribute size limits + retention tiers |

### The `spanmetrics` cardinality trap

The `spanmetrics` connector derives RED metrics from spans — free RED dashboards from your traces. But it turns *span attributes into metric label dimensions*. If you include `http.target` (full path with IDs) as a dimension, you've created a metric with unbounded cardinality — the classic way to take down Prometheus. **Only low-cardinality, bounded attributes become `spanmetrics` dimensions** (`service.name`, `http.route` *template*, `http.response.status_code`, `span.kind`), never raw paths, user IDs, or query strings.

```yaml
connectors:
  spanmetrics:
    dimensions:                   # ONLY bounded, low-cardinality keys become metric labels
      - { name: http.route }      # the TEMPLATE /users/{id}, never the concrete path
      - { name: http.response.status_code }
      - { name: service.name }
    # NEVER add http.target, url.full, user.id, request.id here — metric cardinality explosion.
```

### Enforce normalization in the Collector, not in 200 apps

A team *will* eventually emit `http.route = /users/12345?token=abc`. You don't catch it in code review across 200 repos; you normalize it centrally:

```yaml
processors:
  transform/normalize:
    trace_statements:
      - context: span
        statements:
          # Strip query strings (they hide tokens AND explode cardinality).
          - replace_pattern(attributes["url.full"], "\\?.*", "")
          # Template numeric IDs in routes.
          - replace_pattern(attributes["http.route"], "/[0-9]+", "/{id}")
          # Drop a body attribute someone added — never index request bodies.
          - delete_key(attributes, "http.request.body")
```

### The cardinality budget, stated

Set it explicitly, the way senior set an overhead budget: **a bounded set of searchable/indexed attribute keys per span domain; zero high-cardinality keys as `spanmetrics` dimensions; query strings and bodies always stripped.** Enforce it in the Collector and lint for it in CI. Cardinality intuition transfers directly from metrics — see [`../metrics/senior.md`](../metrics/senior.md) — but the enforcement point for traces is the pipeline, because you can't trust 200 teams to self-police.

---

## Building Org-Wide Instrumentation Standards

This is the genuinely staff-level work and the part with no clean code answer — it's a socio-technical system.

### The standard is a *library*, not a *document*

Ship a single internal bootstrap module per language that wires *everything* correctly, so a team's tracing setup is one line:

```go
// internal/otelboot — the company standard, one import, correct by construction.
shutdown, err := otelboot.Init(ctx, otelboot.Config{
    ServiceName: "checkout",   // the ONLY thing the team must provide
    // Everything else — sampler, batch processor, propagators (TraceContext+governed Baggage),
    // resource detectors, OTLP-to-localhost, span limits, semconv version — is baked in.
})
defer shutdown(ctx)
```

When the standard is a library:
- Changing the sampler fleet-wide is a library version bump (or, better, a Collector/OpAMP change with the library staying dumb).
- A new team gets correct, semconv-compliant, propagation-safe tracing with zero decisions to make.
- "The standard" can't drift, because there's nothing to copy-paste wrong.

### Semantic-convention governance — pin, version, migrate in lockstep

Senior named the drift failure mode (a service vanishing from a dashboard). Professional runs the *migration process* across the org:

1. **Pin a semconv version** in the bootstrap library. Every service inherits it.
2. **Use the schema-URL mechanism** so the backend/Collector knows which convention version each service speaks and can transform old→new automatically.
3. **Run `dup` during migration** (`OTEL_SEMCONV_STABILITY_OPT_IN=http/dup`) so both old and new names emit; update dashboards to new names; then drop old.
4. **CI lints** custom attributes for namespacing (`acme.*`) and flags any deprecated semconv key.
5. **Treat a service disappearing from a fleet dashboard as a P2 incident**, with an owner — not a curiosity.

### Adoption is the hard half

The technical bootstrap library is 20% of the work. The 80%:

- **Make non-adoption visible.** A dashboard of "services emitting traces / total services," "services on the current semconv version," "services with PII redaction confirmed." You can't drive what you can't see.
- **Make the default path the easy path.** New-service templates (cookiecutter, `create-service`) include `otelboot` pre-wired. The friction of *not* having tracing is higher than having it.
- **Gate at the platform layer.** A service that doesn't export traces doesn't get into the service mesh / doesn't pass the production-readiness review. Standards with teeth.
- **Provide the win, not the chore.** Teams adopt because the on-call experience is dramatically better (exemplars, end-to-end traces), not because a wiki told them to. Sell the workflow.

### The standards table

| Standard | Enforced by | Failure if absent |
|---|---|---|
| One bootstrap library per language | The library exists and is the templated default | Per-team drift; inconsistent sampling/propagation |
| Pinned semconv version | Library + CI lint | Silent dashboard holes (drift) |
| Governed baggage (allowlist + cap) | A wrapped propagator in the library | PII leak, header bloat, trust escalation |
| PII redaction | Collector config (central), not apps | Secrets searchable in the trace backend |
| Cardinality limits / normalization | Collector + CI lint | Index/`spanmetrics` cost explosion |
| Propagation correctness | Traced primitives (pools, clients) + CI propagation test | Orphan spans, traces that "stop" |
| Exemplars wired | Metrics SDK config + Grafana data-source links | Metrics and traces stay disconnected |

---

## Auto-Instrumentation at Fleet Scale

Manual instrumentation does not scale to 300 services. Auto-instrumentation gives correct traces with zero app code — but at fleet scale it has its own design problems.

### The mechanisms per language

| Language | Mechanism | What it covers automatically |
|---|---|---|
| **Java** | `-javaagent:opentelemetry-javaagent.jar` (bytecode instrumentation) | Servlet, Spring, JDBC, Kafka, gRPC, HTTP clients — hundreds of libraries, no code change |
| **Python** | `opentelemetry-instrument` wrapper / `opentelemetry-bootstrap` | WSGI/ASGI, requests, SQLAlchemy, psycopg, Kafka, Celery |
| **Node** | `--require @opentelemetry/auto-instrumentations-node/register` (monkey-patching) | http, express/fastify, pg, ioredis, kafkajs, grpc |
| **Go** | **No runtime agent** (no monkey-patching) — compile-time `otelhttp`/`otelgrpc` wrappers, or eBPF (`odigos`/Beyla) | Wrapped handlers/clients; eBPF gives zero-code at the kernel level |
| **.NET** | Auto-instrumentation via CLR profiler | ASP.NET Core, HttpClient, SQL, etc. |
| **K8s, any language** | OTel Operator auto-injects the agent as an init-container | Fleet-wide enablement without per-app Dockerfile changes |

### The Go exception and eBPF

Go has no monkey-patching (static binaries, no runtime agent), so historically Go needed explicit `otelhttp`/`otelgrpc` wrappers. The frontier answer is **eBPF auto-instrumentation** (Grafana Beyla, Odigos) — kernel-level tracing of HTTP/gRPC with *zero code change and zero recompile*, language-agnostic. It can't see inside application logic (no business spans), but it gives you the request-boundary spans for free across any language. See [`../dynamic-instrumentation-and-ebpf/`](../dynamic-instrumentation-and-ebpf/) for the eBPF foundations.

### The fleet-scale auto-instrumentation problems you own

1. **Version skew.** The agent, the SDK, and the semconv version must be compatible across the fleet. A team on an old agent emits old attribute names → drift. Centralize the agent version (OTel Operator injection, OpAMP).
2. **Auto-instrumentation captures too much.** It *will* record `Authorization` headers, query strings, and full SQL by default. This is the PII story — strip it in the Collector, fleet-wide, once.
3. **Auto + manual coexistence.** Auto gives the HTTP/DB spans; teams add business spans manually as children. The auto span must be the parent — verify the active context flows into manual spans (it does if you use the SDK's context, breaks if a team re-roots).
4. **Auto-instrumentation overhead.** Bytecode/monkey-patch instrumentation has a startup and per-call cost. For latency-critical services, measure it against the overhead budget and selectively disable noisy instrumentations (`OTEL_INSTRUMENTATION_<lib>_ENABLED=false`).

### K8s Operator injection — fleet enablement without touching apps

```yaml
# The OTel Operator injects the agent as an init-container based on an annotation —
# enable tracing for a whole namespace without editing a single Dockerfile.
apiVersion: opentelemetry.io/v1alpha1
kind: Instrumentation
metadata: { name: fleet-default }
spec:
  exporter: { endpoint: http://otel-agent.observability:4317 }
  propagators: [tracecontext, baggage]
  sampler: { type: parentbased_always_on }   # app exports all; gateway tail-samples
  java:   { image: ghcr.io/open-telemetry/opentelemetry-operator/autoinstrumentation-java }
  python: { image: ghcr.io/open-telemetry/opentelemetry-operator/autoinstrumentation-python }
---
# Pods opt in with one annotation — the standard becomes a label, not a code change.
metadata:
  annotations:
    instrumentation.opentelemetry.io/inject-java: "true"
```

---

## Code Examples

### The company bootstrap library (Go) — what "the app stays dumb" looks like

```go
package otelboot

import (
    "context"
    "go.opentelemetry.io/otel"
    "go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
    "go.opentelemetry.io/otel/propagation"
    "go.opentelemetry.io/otel/sdk/resource"
    sdktrace "go.opentelemetry.io/otel/sdk/trace"
    semconv "go.opentelemetry.io/otel/semconv/v1.26.0" // PINNED semconv version, fleet-wide
)

type Config struct{ ServiceName string }

func Init(ctx context.Context, cfg Config) (func(context.Context) error, error) {
    res, err := resource.New(ctx,
        resource.WithAttributes(semconv.ServiceName(cfg.ServiceName)),
        resource.WithProcess(), resource.WithContainer(),
        resource.WithFromEnv(),          // OTEL_RESOURCE_ATTRIBUTES + detectors
        resource.WithTelemetrySDK(),
    )
    if err != nil {
        return nil, err
    }
    // Export EVERYTHING to the node-local agent. The gateway tail-samples.
    exp, err := otlptracegrpc.New(ctx,
        otlptracegrpc.WithEndpoint("localhost:4317"), otlptracegrpc.WithInsecure())
    if err != nil {
        return nil, err
    }
    tp := sdktrace.NewTracerProvider(
        sdktrace.WithResource(res),
        sdktrace.WithSampler(sdktrace.ParentBased(sdktrace.AlwaysSample())), // 100% → collector
        sdktrace.WithSpanProcessor(sdktrace.NewBatchSpanProcessor(exp,
            sdktrace.WithMaxQueueSize(2048), sdktrace.WithMaxExportBatchSize(512))),
        sdktrace.WithSpanLimits(sdktrace.SpanLimits{ // bound span growth, fleet-wide
            AttributeCountLimit: 64, EventCountLimit: 64, LinkCountLimit: 32,
        }),
    )
    otel.SetTracerProvider(tp)
    // TraceContext + GOVERNED baggage (allowlist+cap), composed — one place, every service.
    otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
        propagation.TraceContext{},
        newGovernedBaggage(512, "tenant.id", "experiment.variant"),
    ))
    return tp.Shutdown, nil // graceful-shutdown flush — wired into the company's main() template
}
```

### A CI propagation test — fail the build if a trace stops

```go
// This is the test that makes propagation a CONTRACT, not a hope.
// Run in CI: spin up the service, send a request, assert the downstream span
// shares the inbound trace ID. Catches "someone used a raw goroutine" at PR time.
func TestPropagationAcrossInternalCall(t *testing.T) {
    rec := newInMemorySpanRecorder() // capture exported spans in-process
    initTestTracing(rec)

    inboundTraceID := "4bf92f3577b34da6a3ce929d0e0e4736"
    req := httptest.NewRequest("POST", "/checkout", nil)
    req.Header.Set("traceparent", "00-"+inboundTraceID+"-00f067aa0ba902b7-01")

    handler.ServeHTTP(httptest.NewRecorder(), req)

    spans := rec.Ended()
    require.NotEmpty(t, spans, "no spans exported — instrumentation missing")
    for _, s := range spans {
        require.Equal(t, inboundTraceID, s.SpanContext().TraceID().String(),
            "span %q has wrong trace ID — context was LOST across a boundary", s.Name())
    }
}
```

### Gateway Collector config — the full stateful tier

```yaml
receivers:
  otlp: { protocols: { grpc: { endpoint: 0.0.0.0:4317 } } }

processors:
  memory_limiter: { check_interval: 1s, limit_percentage: 80, spike_limit_percentage: 25 }
  groupbytrace:                         # buffer whole traces before tail sampling
    wait_duration: 10s
    num_traces: 200000                  # MEMORY BOUND — sized from RPS × wait_duration
  tail_sampling:
    decision_wait: 10s
    num_traces: 200000
    policies:
      - { name: errors, type: status_code, status_code: { status_codes: [ERROR] } }
      - { name: slow,   type: latency,     latency: { threshold_ms: 1000 } }
      - name: baseline
        type: and
        and:
          and_sub_policy:
            - { name: p,  type: probabilistic, probabilistic: { sampling_percentage: 1 } }
            - { name: rl, type: rate_limiting, rate_limiting: { spans_per_second: 500 } }
  batch: { timeout: 5s, send_batch_size: 8192 }

connectors:
  spanmetrics:                          # RED metrics from spans — bounded dimensions only
    dimensions:
      - { name: http.route }
      - { name: http.response.status_code }

exporters:
  otlp/tempo:  { endpoint: tempo:4317, tls: { insecure: true } }
  prometheus:  { endpoint: 0.0.0.0:8889 }

service:
  pipelines:
    traces:
      receivers:  [otlp]
      processors: [memory_limiter, groupbytrace, tail_sampling, batch]
      exporters:  [otlp/tempo, spanmetrics]
    metrics/spanmetrics:
      receivers:  [spanmetrics]
      exporters:  [prometheus]
```

### Routing tier — the loadbalancing exporter that makes shards see whole traces

```yaml
# Tier-1 (stateless) routing Collector: hash by trace ID to tier-2 instances.
exporters:
  loadbalancing:
    routing_key: traceID                # ← THE load-bearing line: whole trace → one gateway
    protocol: { otlp: { tls: { insecure: true } } }
    resolver:
      k8s: { service: otel-gateway.observability }   # discovers tier-2 instances dynamically
service:
  pipelines:
    traces:
      receivers:  [otlp]
      processors: [memory_limiter, batch]
      exporters:  [loadbalancing]
```

### Python — exemplar emission tied to sampling

```python
from opentelemetry import trace, metrics

tracer = trace.get_tracer("checkout")
meter = metrics.get_meter("checkout")
latency = meter.create_histogram("http.server.duration", unit="s")

def handle(request):
    # Recording the histogram INSIDE the sampled span attaches the trace_id as an exemplar.
    with tracer.start_as_current_span("handle") as span:
        import time
        start = time.monotonic()
        process(request)
        # The active span's context is implicit; the SDK reads it to attach the exemplar.
        latency.record(time.monotonic() - start, {"http.route": request.route})
        # If this trace is later kept by tail sampling (error/slow/baseline), the exemplar
        # link resolves. Align sampling so latency-bucket exemplars point to KEPT traces.
```

---

## Real Failure Stories

These are the shapes of staff-level tracing incidents — the ones that don't happen to a single service but to the *platform*.

### 1. The baggage that 431'd the mesh

A team added rich context to baggage for "debuggability" — `user.email`, `cart.contents` (a JSON blob), `experiment.assignments` (a list). It worked in test. In production, deep in a 22-hop request path, an internal proxy enforced an 8KB total-header limit. Requests started returning `431 Request Header Fields Too Large` — but only on the *deepest* paths, intermittently, looking like a flaky downstream. Two days of misdirected debugging. *Lesson:* baggage rides every hop and accumulates; it is plaintext header bytes multiplied by hop count. Govern it with an allowlist and a hard size cap in the propagator, and never put blobs or PII in it. The fix was a governed-baggage propagator shipped in the bootstrap library; the deeper fix was making "what goes in baggage" a reviewed decision, not a free-for-all.

### 2. The tail sampler that sampled phantom traces

A team scaled their tail-sampling Collector horizontally to handle growth — added five instances behind a plain round-robin load balancer. Tracing *looked* fine. Weeks later, during an incident, engineers noticed traces were missing spans and error traces weren't being kept. Root cause: round-robin meant the spans of one trace were *scattered* across five Collector instances; no single instance saw a whole trace, so `tail_sampling` decided on fragments — keeping partial traces and dropping errors whose spans landed on a different instance. *Lesson:* tail sampling requires all spans of a trace on one instance. You must route by trace ID (`loadbalancing` exporter, two-tier topology), not round-robin. A horizontally-scaled tail sampler *without* trace-ID routing is silently broken.

### 3. The spanmetrics connector that took down Prometheus

A platform team enabled the `spanmetrics` connector to get free RED dashboards — great win. They included `http.target` as a dimension "for granularity." `http.target` contained full paths with embedded user IDs and query strings: millions of unique values. The derived metric had millions of label combinations. Prometheus ingestion ballooned, the TSDB ran out of memory, and the *metrics* backend — the thing you alert on — went down during business hours. *Lesson:* `spanmetrics` turns span attributes into metric dimensions, and metric cardinality is unforgiving. Only low-cardinality, *templated* attributes (`http.route`, not `http.target`) may be dimensions. Cardinality intuition from [`../metrics/senior.md`](../metrics/senior.md) applies directly — and the enforcement point is the connector config.

### 4. The semconv migration that blinded the company

A platform-wide agent upgrade moved the fleet from `http.method` to `http.request.method` over a weekend. The bootstrap library was bumped, services redeployed on their own cadence — so for two weeks, *half* the fleet emitted old names and half emitted new. Every cross-service dashboard and SLO alert that queried one name silently lost half its data. SLO error budgets looked artificially healthy (half the errors were under a key the alert didn't query). *Lesson:* a semconv migration across a fleet that deploys on independent cadences *must* run with `dup` (both names emitted) until the slowest service migrates, with dashboards querying both names during the window. The schema-URL mechanism and a "% of fleet on current semconv" dashboard make the migration observable. Treat fleet-wide attribute renames like a database migration — expand, migrate, contract.

### 5. The orphaned subprocess traces

A data-pipeline team's traces "stopped" at a step that shelled out to a CLI tool for heavy processing. The Python service was perfectly instrumented; `contextvars` flowed across its `asyncio` tasks. But the `subprocess.run()` call crossed a *process* boundary — no shared memory, no context — and the child's spans started a fresh, parentless trace. The team had assumed "we use the standard library, so propagation works." *Lesson:* every process boundary is a queue. `subprocess`, `multiprocessing`, `ProcessPoolExecutor`, `worker_threads`, a Lambda invoke — context must be injected into a carrier (env var, message attribute, `workerData`) and extracted on the other side. The fix shipped as a traced-subprocess helper in the bootstrap library, with a CI test asserting the child span shares the parent trace ID.

### 6. The exemplar links that went nowhere

A team wired exemplars: histograms emitted trace IDs, Grafana rendered the dots. But clicking an exemplar on the slow-latency panel led to "trace not found" perhaps 80% of the time. Cause: head sampling at 1% dropped most traces *including the ones exemplars pointed at*. The exemplar recorded a trace ID at metric-record time; sampling decided independently to drop that trace. *Lesson:* exemplars are only useful if the trace they point to is *kept*. Either keep 100% from the app and tail-sample (so the slow/errored traces exemplars care about survive), or use a consistent sampler so the exemplar's trace ID and the kept-trace set align. Exemplar usefulness is a *joint* property of metrics and sampling policy — owning both is the staff job.

---

## Mental Models

### "The app is a sensor; the Collector is the brain"

The application's only job is to *emit signal* — full-fidelity, dumb, fast, and non-blocking. All *judgment* (what to keep, what to redact, what to enrich, where to send) lives in the Collector, which you change without redeploying sensors. When you find yourself wanting to put policy in app code, ask: "would I have to redeploy 200 services to change this?" If yes, it belongs in the Collector.

### "Every boundary without shared memory is a queue"

Network hop, message broker, process boundary, thread isolate, serverless invoke, subprocess. The unifying truth: if there's no shared address space, context can't ride a variable — it must be *serialized into a carrier and reconstructed*. Engineers who internalize this stop being surprised when traces "stop": they immediately ask "what's the carrier across this boundary, and did we inject/extract?"

### "Sampling and exemplars and cardinality are one budget"

These look like three topics; they're one resource-allocation problem. Sampling decides how many traces you keep; that set must include the traces exemplars point to; the attributes on those traces drive index and `spanmetrics` cost. A staff engineer reasons about them together: "if I tail-sample to keep errors and slow traces, my latency-panel exemplars resolve, and if I bound attribute cardinality in the Collector, the kept traces are cheap to index." One budget, three knobs.

### "Standards are gravity, not walls"

You cannot wall off 200 teams from doing the wrong thing. But you can make the right thing *downhill* — the templated default, the one-line bootstrap, the pre-wired pool, the CI test that catches the regression. Adoption follows the gradient. A standard that requires uphill effort (read docs, copy config, remember to wrap) loses to entropy. Build gravity.

---

## Pros & Cons

| Decision | Pros | Cons |
|---|---|---|
| **App stays dumb / Collector owns policy** | Change sampling/redaction/backend without redeploys; one enforcement point | Collector becomes tier-0; you must operate it like a database |
| **Two-tier tail sampling** | Keeps every error/slow trace at fleet scale; whole-trace decisions | Stateful, sharded, memory-bound; routing-by-trace-id is non-negotiable and easy to get wrong |
| **OpAMP control plane** | Fleet-wide config/policy changes in one action | Another control system to run and secure |
| **Governed baggage** | Useful deep-service context without bloat/leak | Requires a custom propagator and discipline; teams chafe at the allowlist |
| **Exemplars** | One-click metric→trace; collapses detection→diagnosis | Only works if sampling keeps the pointed-to traces; needs backend wiring |
| **`spanmetrics` RED from traces** | Free RED dashboards, no separate instrumentation | Cardinality footgun; sampling skews the rates |
| **Bootstrap library standard** | Correct-by-default; no drift; one-line setup | Must be maintained, versioned, and adopted; language-by-language effort |
| **Auto-instrumentation fleet-wide** | Traces with zero app code; broad coverage | Captures PII by default; version skew; overhead on hot paths |

---

## Use Cases

- **"Change fleet-wide sampling during an incident."** App exports 100%; push a Collector/OpAMP policy change — no redeploys.
- **"Migrate from Jaeger to Tempo with zero downtime."** Collector dual-writes to both; cut over when confident.
- **"Keep every error trace at 2M spans/sec."** Two-tier tail sampling: `loadbalancing` route-by-trace-id → sharded `tail_sampling` gateway, sized by the buffer math.
- **"A p99 spike needs a representative trace in one click."** Exemplars: histograms emit trace IDs inside sampled spans; Grafana links to Tempo.
- **"Free RED dashboards from existing traces."** `spanmetrics` connector with *bounded* dimensions.
- **"Stop PII appearing in the trace UI fleet-wide."** Central redaction in the agent Collector; one policy, every service.
- **"Propagate `tenant.id` to deep services without re-deriving it."** Governed baggage (allowlist + cap), stripped at the perimeter.
- **"Trace stops at the subprocess / worker thread / process pool."** Inject/extract through a carrier; ship it as a traced primitive.
- **"Get 300 services tracing without a 300-PR campaign."** OTel Operator agent injection by annotation; bootstrap library as the templated default.

---

## Coding Patterns

### Pattern: the one-line bootstrap

```go
shutdown, _ := otelboot.Init(ctx, otelboot.Config{ServiceName: "checkout"})
defer shutdown(ctx) // sampler, processor, propagators, semconv, limits — all baked in
```

### Pattern: traced primitive, not documented wrapping

```java
ExecutorService pool = Context.taskWrapping(Executors.newFixedThreadPool(16));
// Teams use 'pool' from a shared factory; they never see (or forget) the wrapping.
```

### Pattern: carrier across every memory boundary

```python
carrier = {}
inject(carrier)                       # serialize context at the boundary
result = pool.submit(_run, payload, carrier)  # process pool, worker, subprocess — same shape
# ... on the other side:
with tracer.start_as_current_span("work", context=extract(carrier)):
    ...
```

### Pattern: governed baggage, not raw baggage

```go
// Set baggage only through a helper that enforces the allowlist + cap.
ctx = otelboot.SetBaggage(ctx, "tenant.id", tenantID) // rejects unknown keys; bounds size
```

### Pattern: record metrics inside the span for exemplars

```go
ctx, span := tracer.Start(ctx, "handle"); defer span.End()
// ... work ...
latency.Record(ctx, dur.Seconds()) // ctx carries the sampled span → exemplar attached
```

---

## Clean Code

- **The application's tracing config is one line.** Sampler, processor, propagators, semconv version, span limits, redaction — none of it lives in app code. If it does, you've hard-coded a policy you'll need a company migration to change.
- **Tail sampling routes by trace ID.** A horizontally-scaled tail sampler without `loadbalancing routing_key: traceID` is silently broken. This is not optional.
- **`memory_limiter` first, `batch` last; redact before export.** Processor order is correctness, not style.
- **Baggage goes through a governed propagator** with an allowlist and a size cap, and is stripped at the perimeter. Never PII, never secrets, never authorize on it.
- **Every memory boundary uses a carrier.** Process pools, worker threads, subprocesses, and serverless invokes inject/extract — they don't rely on shared-memory propagation that doesn't exist.
- **`spanmetrics` dimensions are low-cardinality and templated only.** `http.route`, never `http.target`. One bad dimension takes down Prometheus.
- **Normalization and redaction are central** (Collector), not scattered across 200 apps.
- **Propagation is tested in CI.** A test asserts the downstream/child span carries the inbound trace ID across HTTP, the queue, and the process boundary.
- **Exemplars are wired end-to-end** and sampling keeps the traces they point to.
- **Semconv is pinned, versioned (schema URL), and migrated with `dup`.** A service vanishing from a dashboard is a P2.

---

## Best Practices

1. **Keep the app dumb; put all policy in the Collector**, managed centrally (OpAMP). Apps export 100% (or high ratio) OTLP to localhost.
2. **Design tail sampling as a two-tier, trace-ID-routed system.** Size the buffer from `RPS × decision_wait × spans × bytes`, for the *worst* trace, and alert on Collector memory and late spans.
3. **Compose the baseline sampling policy** (`probabilistic` AND `rate_limiting`) so a traffic spike can't blow the buffer; keep errors/slow unbounded by design.
4. **Govern baggage** with a custom propagator (allowlist + hard size cap), strip it at the perimeter, and never authorize on it.
5. **Ship propagation as library code** — traced pools, traced clients, carrier helpers for every memory boundary — and **test propagation in CI**.
6. **Wire exemplars** (record metrics inside sampled spans; link Prometheus→Tempo in Grafana) and align sampling so exemplar targets are kept.
7. **Enforce cardinality in the pipeline:** attribute allowlist, route templating, query-string stripping, and *only* low-cardinality `spanmetrics` dimensions.
8. **Pin semconv fleet-wide, use schema URLs, migrate with `dup`,** and make "% of fleet on current semconv" a visible metric.
9. **Standardize via a one-line bootstrap library** per language; make it the templated default and gate production-readiness on it.
10. **Roll out auto-instrumentation via the OTel Operator** (annotation-based injection), centralize agent versions, and redact what it over-captures.
11. **Operate the Collector as tier-0:** redundancy, `memory_limiter`, bounded `sending_queue`, and alerts on refused/dropped/late spans and export failures.
12. **Plan backend migrations with dual-write** through the Collector; never make apps aware of the backend.

---

## Edge Cases & Pitfalls

- **Round-robin in front of tail sampling** → spans scattered across instances → decisions on partial traces. Route by trace ID.
- **Late spans** arriving after `decision_wait` are dropped (the decision was already made). A service that buffers spans before export, or a very long trace, loses its tail. Alert on the late-span counter.
- **`spanmetrics` with a high-cardinality dimension** → metric explosion → Prometheus OOM. Templated, low-cardinality dimensions only.
- **Baggage across the perimeter** → PII leak to a third party, or trust escalation from an injected value. Strip at egress.
- **Exemplars pointing to dropped traces** → dead links. Sampling must keep what exemplars reference.
- **Semconv migration across independent deploy cadences** without `dup` → half the fleet under old names → blinded dashboards and falsely-healthy SLOs.
- **Process / worker-thread / subprocess boundary assumed to propagate** → orphan traces. Use a carrier.
- **Collector `memory_limiter` not first** → buffering processors OOM before the limiter engages.
- **OpAMP/agent version skew** → a fraction of the fleet emits old semconv or behaves differently under the "same" policy.
- **`spanmetrics` rates computed from sampled spans** → wrong rates (sampling biases them). Derive `spanmetrics` *before* tail sampling, or accept they're estimates and trust real metrics for SLOs.
- **A bootstrap library that bakes the backend endpoint** → defeats the "swap backend without redeploy" property. The app targets localhost; the Collector targets the backend.

---

## Common Mistakes

1. **Putting sampling/redaction/backend policy in app code** instead of the Collector → every change is a fleet redeploy.
2. **Scaling tail sampling without trace-ID routing** → silently broken (partial-trace decisions).
3. **Not sizing the tail-sampling buffer for the worst trace** → OOM exactly during the incident you needed it for.
4. **Ungoverned baggage** → header bloat (431s), PII leak, trust escalation.
5. **Assuming `contextvars`/`async_hooks` cross process/thread-isolate boundaries** → orphan traces at subprocesses, process pools, worker threads.
6. **High-cardinality `spanmetrics` dimensions** → metrics-backend outage.
7. **Fleet semconv migration without `dup`** → silent dashboard holes and wrong SLOs.
8. **Exemplars without aligning sampling** → links to traces that were dropped.
9. **Treating the Collector as fire-and-forget** instead of tier-0 → blind pipeline during an incident.
10. **A standards *document* instead of a standards *library*** → drift, copy-paste errors, low adoption.
11. **Auto-instrumentation shipped without redaction** → PII searchable in the trace UI fleet-wide.
12. **Computing rates from spans/`spanmetrics`** and trusting them for alerting → sampling-biased numbers. Alert on real metrics.

---

## Tricky Points

- **Tail sampling structurally delays traces by `decision_wait`.** Never alert on trace arrival — alert on (real-time, unsampled) metrics; use the late traces to investigate. This is the deepest reason metrics and traces are not interchangeable.
- **Consistent probability sampling (`r`/`th`) lets you sample *down* across layers without partial traces** — but it's blind to outcome. It and tail sampling solve different problems; you may run both (head ratio cascade for volume, tail for keeping errors).
- **`spanmetrics` runs *before or after* tail sampling matters.** Before: rates are accurate (all spans) but you pay to process everything; after: rates are sampling-biased. Most setups run `spanmetrics` on the full stream (agent or pre-tail) precisely so the derived RED metrics are *not* sampled.
- **Baggage is propagated and *trusted*; it is not authenticated.** A value set by an untrusted edge arrives at a deep service looking identical to one your gateway set. Authorizing on baggage is a privilege-escalation bug.
- **An exemplar is recorded at metric time, but the keep/drop decision happens later** (tail) or independently (head ratio). Their alignment is something you *engineer*, not something you get for free.
- **The `loadbalancing` exporter's resolver must track instances as they scale.** A DNS/k8s resolver that lags behind a scale-up sends traces to dead instances; a resolver that rebalances aggressively re-shards trace IDs mid-flight, splitting in-flight traces. Tune the resolver's refresh.
- **Resource detection runs once at startup.** A pod that changes identity (rare) or env vars injected late won't be reflected. For dynamic enrichment (current k8s metadata), enrich in the agent (`k8sattributes`), not only via SDK detectors.
- **`Context.taskWrapping` captures context at *submit* time, not *run* time.** If you wrap the executor once and submit from many contexts, each submission captures *its* context — which is correct. But wrapping a `Runnable` with `Context.current().wrap()` captures at wrap time; mismatch the two and you get the wrong parent.

---

## Anti-Patterns at Professional Level

| Anti-pattern | Why it's wrong | Do instead |
|---|---|---|
| **Per-service sampling config** | Drift; can't change fleet-wide without 200 redeploys | Central policy in the Collector / OpAMP |
| **Tail sampling behind round-robin** | Partial-trace decisions; silent data loss | `loadbalancing routing_key: traceID`, two tiers |
| **Baggage as a free-for-all** | Bloat, PII leak, trust escalation | Governed propagator: allowlist + cap + perimeter strip |
| **Standards-as-wiki** | Nobody reads it; entropy wins | Standards-as-library + CI enforcement + templated defaults |
| **`spanmetrics` for granular dimensions** | Metric cardinality explosion | Low-cardinality, templated dimensions only |
| **Exemplars without sampling alignment** | Dead links to dropped traces | Keep the traces exemplars point to (tail/consistent sampling) |
| **App knows the backend** | Backend swaps require fleet redeploys | App → localhost OTLP; Collector → backend |
| **Manual propagation in 200 repos** | Inconsistent, error-prone, traces "stop" | Traced primitives + CI propagation tests |
| **Big-bang semconv rename** | Blinds dashboards across mixed-version fleet | Expand (`dup`) → migrate → contract, with a coverage metric |
| **Collector as fire-and-forget** | Blind pipeline during the incident you need it for | Operate as tier-0: redundancy, limits, alerts |

---

## A Worked Rollout — Standardizing Tracing Across 200 Services

A realistic staff-led program, end to end. The goal: every service emits correct, affordable, privacy-safe traces, navigable from metrics, within two quarters — without a 200-PR campaign.

**Phase 0 — Baseline and buy-in (week 1–2).** Build the visibility first: a dashboard of "services emitting traces / total," "services on current semconv," "services with confirmed PII redaction." It shows ~15% coverage, five semconv versions in the wild, and `Authorization` headers in the trace backend. This dashboard is the program's scoreboard and the buy-in argument to leadership.

**Phase 1 — The platform, not the apps (week 3–6).** Stand up the Collector tiers: agent DaemonSet (enrich, redact, route) and a gateway (groupbytrace, tail_sampling, spanmetrics). Redaction goes in *first* — strip `Authorization`, cookies, and query strings fleet-wide, so even the 15% already tracing stops leaking immediately. This is a platform change with zero app involvement; it improves safety for everyone on day one.

**Phase 2 — The bootstrap library (week 5–9, overlapping).** Ship `otelboot` for the top two languages (say Java and Go cover 70% of services). One-line init, pinned semconv, governed baggage, AlwaysOn sampler (gateway tail-samples), span limits, OTLP-to-localhost. Wire it into the `create-service` template so every *new* service is correct by default. Add the CI propagation test as a shared check.

**Phase 3 — Auto-instrumentation for breadth (week 8–12).** Deploy the OTel Operator; enable annotation-based agent injection. Now a team enables tracing by adding one annotation — no Dockerfile change. Centralize the agent version. Coverage jumps from 15% to ~60% in a few weeks as teams opt in for the on-call win (end-to-end traces + exemplars), not because they were told to.

**Phase 4 — Exemplars and the workflow win (week 10–14).** Wire histograms to emit exemplars and link Grafana panels to Tempo. Demo it in an incident review: "p99 spiked, one click, here's the slow trace." This is the moment adoption stops being a push and becomes a pull — teams want exemplars, so they want the bootstrap library and the gateway.

**Phase 5 — The semconv migration (week 12–18).** With most of the fleet on `otelboot`, run the long-overdue `http.method` → `http.request.method` migration: bump the library to emit `dup`, update dashboards to query both, watch the "% on current semconv" metric climb as services redeploy, then drop the old names when it hits ~100%. Expand-migrate-contract, observable the whole way.

**Phase 6 — Teeth and steady state (week 16+).** Production-readiness review now requires: emits traces, on current semconv, redaction confirmed, propagation test passing. Non-compliance is visible on the scoreboard and blocks the readiness sign-off. The standard is now gravity (templated default + the exemplar win) *and* a wall (the gate). Steady state: the Collector tiers are tier-0 with on-call and alerts; semconv migrations are routine expand-migrate-contract; new services are correct by default.

**What made it work:** the platform changes (redaction, Collector) delivered value with *zero* app effort first; the exemplar workflow made adoption a pull, not a push; and "the standard" was always *code and config* (library, template, Operator annotation, CI test), never a document. The scoreboard made progress and gaps undeniable. That is the shape of a staff-level observability program.

---

## Test Yourself

1. Why must the application's tracing config be "dumb," and name three things that therefore belong in the Collector instead. What property do you lose if the app hard-codes the backend endpoint?
2. Draw the two-tier tail-sampling topology. Which exporter and which setting make a sharded gateway see whole traces, and what breaks without it?
3. Your gateway does 30k traces/sec with `decision_wait: 10s`, ~25 spans/trace, ~1KB/span, sharded across 6 instances. Estimate per-instance buffer memory. What do you set, and what do you alert on?
4. List the three baggage failure modes and the governance control for each. Why must you never authorize on a baggage value?
5. A team `subprocess.run()`s a CLI tool and the trace "stops." Explain why and write the fix. Generalize the rule to three other boundaries.
6. What is an exemplar, and what *two* conditions must hold for an exemplar link to resolve to an actual trace? How does sampling policy interact with this?
7. Why is `http.target` a dangerous `spanmetrics` dimension but `http.route` safe? What outage does getting this wrong cause?
8. You must rename `http.method` → `http.request.method` across a fleet that deploys on independent cadences. Give the three-phase migration and the metric you watch.
9. Why can't you alert on "an error trace appeared in the backend"? What do you alert on instead, and what's the underlying timing reason?
10. A standards *document* failed to drive adoption. Give four ways to make the standard *gravity* instead.

---

## Tricky Questions

**Q1: Where does sampling actually belong — the SDK or the Collector — and why isn't it "both, obviously"?**

It depends on the strategy. *Head ratio* (`ParentBased(TraceIdRatioBased)`) belongs in the SDK: it's cheap, stateless, consistent on trace ID, and needs no buffering. *Tail sampling* belongs in the Collector gateway: it needs the *whole trace*, which only exists after trace-ID routing reassembles it, and it needs buffering memory you don't want in every app. The staff stance is usually **app = AlwaysOn (export everything) + Collector tail-samples** — because that keeps the app dumb and puts the outcome-aware decision where it can see whole traces and be changed fleet-wide without redeploys. It's *not* "both samplers stacked naively," because a naive second sampling stage would keep a different subset and fragment traces; if you *do* cascade, use the consistent-probability (`r`/`th`) mechanism so down-sampling stays whole-trace.

**Q2: A horizontally-scaled tail-sampling Collector is keeping partial traces and dropping errors. Diagnose it.**

The spans of one trace are landing on *different* gateway instances, so no instance sees a whole trace and `tail_sampling` decides on fragments. Almost certainly the gateway is behind a round-robin or per-connection load balancer instead of being fed by a `loadbalancing` exporter with `routing_key: traceID`. Fix: a two-tier topology — a stateless tier-1 that routes by trace-ID hash to a stateful tier-2 that owns trace-ID shards. Also check the resolver: if it lags scale events or rebalances aggressively, in-flight trace IDs get re-sharded and split.

**Q3: Why is baggage a security concern and not just a performance one?**

Two reasons beyond bytes. *Trust:* baggage is propagated and trusted but **not authenticated** — a value injected at an untrusted edge (`user.tier=premium`) arrives at a deep service indistinguishable from one your gateway set, so any service that *authorizes* on baggage has a privilege-escalation bug. *Leakage:* baggage propagates to *every* hop including, if you're careless, across the perimeter to a third party, and it's auto-recorded onto spans — so PII or secrets in baggage become PII/secrets in your trace backend and possibly in someone else's logs. Governance = allowlist + size cap + perimeter strip + "never authorize on it."

**Q4: How do exemplars couple your metrics and sampling, and what goes wrong if you ignore the coupling?**

An exemplar staples a trace ID to a metric data point at *record* time, but whether that trace is *kept* is decided by sampling — later (tail) or independently (head). If sampling drops the trace the exemplar points to, the click leads to "trace not found." So exemplar usefulness is a *joint* property: you must keep the traces exemplars reference. This aligns nicely with tail sampling (which keeps slow/errored traces — exactly the ones whose exemplars sit on the interesting metric buckets), and breaks with naive 1% head sampling. Owning both metrics and sampling is the staff job precisely because of couplings like this.

**Q5: Your `spanmetrics`-derived RED dashboards show different error rates than your "real" metrics. Why, and which do you trust for SLOs?**

Most likely `spanmetrics` is running *after* tail sampling, so it's deriving rates from a *biased* sample (tail sampling over-represents errors and slow traces). Sampled spans are *examples*, not a census; rates from them are wrong. Run `spanmetrics` on the *full, pre-tail* stream (in the agent or before the sampling processor) if you want trustworthy RED metrics — or accept they're estimates and trust your real, unsampled metrics for SLOs. Never compute an SLO from sampled data. (This is the trace-side echo of "rates belong to metrics, not sampled traces" from [`senior.md`](senior.md).)

**Q6: Auto-instrumentation gives you traces with zero app code. What are the three fleet-scale problems it creates, and how do you handle each?**

(1) *PII over-capture* — it records `Authorization`, query strings, full SQL by default; strip them centrally in the agent Collector, once, fleet-wide. (2) *Version skew* — agent/SDK/semconv versions drift across teams, causing convention mismatch; centralize the agent version via the OTel Operator/OpAMP and gate on current semconv. (3) *Overhead on hot paths* — bytecode/monkey-patch instrumentation has per-call cost; measure against the overhead budget and selectively disable noisy instrumentations. Auto-instrumentation is breadth; you still own the safety, consistency, and cost.

**Q7: A staff engineer says "we changed sampling policy fleet-wide during an incident." How is that physically possible without redeploying services?**

Because the apps are dumb — they export 100% (or a fixed ratio) of spans to a local Collector and contain *no* tail-sampling logic. The actual keep/drop policy lives in the gateway Collector's `tail_sampling` config, pushed to the fleet via OpAMP (or a config rollout). Changing "keep all errors + 5% baseline" to "keep everything for the next hour" is a Collector config change applied centrally in seconds — no app release. This is the entire payoff of the app-is-a-sensor / Collector-is-the-brain architecture.

**Q8: Why is a semconv rename like a database migration, and what's the failure if you skip the discipline?**

Because consumers (dashboards, alerts, SLOs) query a *schema* (attribute names), and producers (services) deploy on independent cadences — so a big-bang rename means the fleet is *mixed-version* for days or weeks, and any query against one name silently loses the other half. The failure is the worst kind: no error, just *absence* — a dashboard with a hole and an SLO alert that under-counts errors (looking falsely healthy). The fix is expand-migrate-contract: emit both names (`dup`), update queries to read both, watch a "% of fleet on current semconv" metric, then drop the old name only at ~100%. Schema URLs let the backend transform automatically during the window.

---

## Cheat Sheet

```text
┌────────────────────────── TRACING — PROFESSIONAL CHEAT SHEET ───────────────────────────┐
│                                                                                          │
│  ARCHITECTURE: app is a SENSOR, Collector is the BRAIN                                    │
│    app → AlwaysOn → OTLP localhost:4317  (NO policy in app code)                          │
│    agent (per node): memory_limiter→enrich(k8s)→REDACT→normalize→batch→route             │
│    gateway (stateful): groupbytrace→tail_sampling→spanmetrics→fan-out to backends        │
│    control plane: OpAMP — change policy fleet-wide, NO app redeploy                       │
│                                                                                          │
│  TAIL SAMPLING = a sharded, memory-bound DATABASE                                         │
│    MUST route by trace-id: loadbalancing exporter routing_key: traceID (2 tiers)         │
│    buffer mem ≈ traces/s × decision_wait × spans × bytes  → size for the WORST trace     │
│    baseline policy = probabilistic AND rate_limiting (spike can't blow the buffer)       │
│    delays traces by decision_wait → ALERT ON METRICS, never on trace arrival             │
│                                                                                          │
│  BAGGAGE = trusted, unbounded, plaintext, every hop                                      │
│    govern: allowlist + size cap + STRIP AT PERIMETER ; NEVER authorize on it / no PII    │
│                                                                                          │
│  PROPAGATION: every boundary w/o shared memory is a QUEUE → inject/extract a carrier      │
│    process pool · worker_threads · subprocess · serverless · gRPC stream                  │
│    ship TRACED PRIMITIVES (pools/clients) + a CI test that fails if trace-id is lost      │
│                                                                                          │
│  EXEMPLARS: record metric INSIDE sampled span → trace-id stapled to data point            │
│    only resolves if sampling KEEPS that trace + Prometheus→Tempo wired in Grafana         │
│                                                                                          │
│  CARDINALITY/COST: enforce in the PIPELINE                                                │
│    spanmetrics dims = LOW-cardinality TEMPLATED only (http.route ✓  http.target ✗)        │
│    normalize routes + strip query strings/bodies in the Collector                        │
│                                                                                          │
│  STANDARDS = a LIBRARY (one-line bootstrap) + CI + templated default, NOT a wiki page     │
│    pin semconv (schema URL) ; migrate with dup (expand→migrate→contract)                  │
│    auto-instrument via OTel Operator annotation ; centralize agent version               │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Summary

- At professional level, tracing is an **organizational platform you operate and version**, not a per-service feature. The reference architecture is **app = dumb sensor, Collector = brain**: apps export everything as OTLP to localhost; *all* policy (sampling, redaction, enrichment, backend, cardinality limits) lives in the Collector and changes fleet-wide via OpAMP with no app redeploy.
- The OTel pipeline is **three tiers**: a dumb SDK, a stateless per-node *agent* (enrich, redact, route), and a stateful *gateway* (buffer whole traces, tail-sample, derive `spanmetrics`, fan out to backends). Collapsing tiers either breaks tail sampling or couples app deploys to pipeline ops.
- **Tail sampling is a sharded, memory-bound distributed system.** It only works if every span of a trace reaches one instance — `loadbalancing routing_key: traceID`, two tiers. Size the buffer for the *worst* trace, compose the baseline (`probabilistic` AND `rate_limiting`), and remember it **delays traces by `decision_wait`** — so alert on metrics, never on trace arrival.
- **Baggage is a governed, security-sensitive channel**, not free context: it bloats every hop, leaks PII, and is trusted-but-unauthenticated (never authorize on it). Govern with an allowlist, a size cap, and a perimeter strip.
- **Every boundary without shared memory is a queue** — process pools, worker threads, subprocesses, serverless. Carry context via a carrier (inject/extract), and ship propagation as *library code* (traced pools/clients) with a **CI test that fails if a trace stops**.
- **Exemplars** staple a trace ID to a metric data point, collapsing detection (metrics) → diagnosis (traces) into one click — but only if sampling *keeps* the pointed-to trace and the backends are wired. Owning metrics *and* sampling is what makes this work.
- **Cardinality and cost are a budget enforced in the pipeline**: low-cardinality templated `spanmetrics` dimensions only (`http.route`, never `http.target`), route normalization and query-string stripping in the Collector — not 200 apps self-policing.
- **Org-wide standards are code, not documents**: a one-line bootstrap library per language, pinned semconv with schema-URL migrations (`dup`, expand-migrate-contract), auto-instrumentation via the OTel Operator, and adoption driven by *gravity* (templated defaults, the exemplar workflow win) plus *teeth* (production-readiness gates). See the sibling pillars — [`../logging/professional.md`](../logging/professional.md), [`../metrics/senior.md`](../metrics/senior.md) — and the consumer of all this, [`../debugging/professional.md`](../debugging/professional.md).

---

## What You Can Build

- A **company OTel bootstrap library** (`otelboot`) per language: one-line init wiring the standard sampler, batch processor, governed-baggage propagator, pinned semconv, span limits, and OTLP-to-localhost — the thing that makes correct tracing the default.
- A **two-tier tail-sampling deployment** with a load test proving it samples *whole* traces under horizontal scaling, plus a buffer-sizing calculator (RPS × decision_wait × spans × bytes) and alerts on Collector memory and late spans.
- A **governed-baggage propagator** with an allowlist, a hard size cap, and a perimeter strip — plus a test that asserts non-allowlisted keys and oversized baggage never propagate, and that egress strips it entirely.
- A **propagation conformance suite** for CI: spins up the service and asserts the downstream/child span carries the inbound trace ID across HTTP, the message queue, a process pool, a worker thread, and a subprocess.
- An **exemplar pipeline**: histograms emitting trace IDs inside sampled spans, Prometheus storing them, Grafana linking to Tempo — demoed by clicking a p99 spike straight to the slow trace.
- A **cardinality guard**: a Collector config (normalization + attribute allowlist) plus a CI lint that flags raw `http.target`/bodies/query strings and any high-cardinality `spanmetrics` dimension before it ships.
- A **semconv migration toolkit**: schema-URL config, a `dup`-mode rollout, and a "% of fleet on current semconv" dashboard that turns a fleet attribute rename into an observable expand-migrate-contract.
- An **OpAMP-managed Collector fleet** where sampling policy and agent version are pushed centrally, with health reporting — so "change sampling fleet-wide in one action" is real.

---

## Further Reading

- **Architecture & Collector**
  - OpenTelemetry Collector architecture (receivers/processors/exporters/connectors) — <https://opentelemetry.io/docs/collector/>
  - Collector deployment patterns (agent vs gateway) — <https://opentelemetry.io/docs/collector/deployment/>
  - OpAMP (Open Agent Management Protocol) spec — <https://opentelemetry.io/docs/specs/opamp/>
  - OTel Operator (auto-instrumentation injection in Kubernetes) — <https://github.com/open-telemetry/opentelemetry-operator>
- **Sampling**
  - `tail_sampling` processor — <https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/processor/tailsamplingprocessor>
  - `groupbytrace` processor and the `loadbalancing` exporter (route-by-trace-id) — contrib repo.
  - Consistent probability sampling — W3C Trace Context Level 2 `tracestate` (`th`/`rv`) — <https://www.w3.org/TR/trace-context-2/>
  - Jaeger adaptive / remote sampling — <https://www.jaegertracing.io/docs/sampling/>
- **Baggage, semconv, exemplars**
  - W3C Baggage — <https://www.w3.org/TR/baggage/>
  - OTel semantic conventions, schema URLs & stability opt-in — <https://opentelemetry.io/docs/specs/semconv/>
  - Exemplars (OTLP metrics) and Prometheus/Grafana wiring — <https://opentelemetry.io/docs/specs/otel/metrics/data-model/#exemplars>
  - `spanmetrics` connector — <https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/connector/spanmetricsconnector>
- **eBPF auto-instrumentation**
  - Grafana Beyla — <https://grafana.com/oss/beyla-ebpf/> ; Odigos — <https://odigos.io/>
- **Books / talks**
  - Yuri Shkuro, *Mastering Distributed Tracing* — adaptive sampling, tail-based sampling architecture, baggage.
  - Charity Majors, Liz Fong-Jones, George Miranda, *Observability Engineering* — sampling economics, high-cardinality, the three-pillars-as-one-product argument.
  - Ted Young / OTel maintainers' talks on the Collector as a control plane.

---

## Related Topics

- **Previous level:** [senior.md](senior.md) — head/tail sampling, the overhead budget, span granularity, async/queue propagation mechanics, semconv-as-contract. The prerequisite for everything here.
- **Foundations:** [middle.md](middle.md) — W3C propagation, inject/extract, span kind. [junior.md](junior.md) — span anatomy.
- **Interview prep:** [interview.md](interview.md). **Practice:** [tasks.md](tasks.md).

**Sibling diagnostic topics:**

- [Logging — Professional](../logging/professional.md) — the logs side of the same platform: central redaction, sampling, and correlation; trace ID as the join key across all three pillars.
- [Metrics — Senior](../metrics/senior.md) — cardinality economics that transfer directly to span attributes and `spanmetrics` dimensions; why rates belong to metrics, not sampled traces.
- [Debugging — Professional](../debugging/professional.md) — the *consumer* of this platform: exemplars as the metric→trace workflow, the observability triangle as a debugging interface, incident response built on the traces you ship.
- [Dynamic Instrumentation & eBPF](../dynamic-instrumentation-and-ebpf/) — zero-code, language-agnostic auto-instrumentation at the kernel level.
- [Telemetry Cost & Sampling Strategy](../telemetry-cost-and-sampling-strategy/) — the economics of the whole pipeline across all signals.
- [Observability Engineering](../observability-engineering/) — the discipline that ties logs, metrics, and traces into one practice.

**Cross-roadmap links:**

- [Backend → Distributed Tracing](../../../Backend/distributed-systems/10-distributed-tracing/) — collector topology, trace-store scaling, and backend storage internals.

---

## Diagrams & Visual Aids

### The Three-Tier Pipeline (who owns what)

```text
   APP (dumb sensor)        AGENT (stateless, per-node)        GATEWAY (stateful, sharded)
   ┌──────────────┐         ┌────────────────────────┐         ┌──────────────────────────┐
   │ AlwaysOn      │  OTLP   │ memory_limiter          │ route   │ groupbytrace (buffer)     │
   │ Batch proc    │ ───────►│ k8sattributes (enrich)  │ by      │ tail_sampling (policies)  │
   │ TraceContext  │ localhost│ attributes (REDACT)    │ trace-id│ spanmetrics (RED metrics) │
   │ +gov Baggage  │  :4317  │ normalize · batch       │ ───────►│ fan-out → Tempo/Datadog   │
   └──────────────┘         └────────────────────────┘         └──────────────────────────┘
                    OpAMP control plane pushes config to AGENT + GATEWAY — app never changes.
```

### Tail Sampling Must See Whole Traces

```text
   WRONG: round-robin LB                      RIGHT: route by trace-id (2 tiers)
   spans of trace T scattered:                 all spans of T → one shard:
     T.s1 → gw-A   T.s2 → gw-C                  tier-1 (stateless) hash(T) → gw-B
     T.s3 → gw-B   ...                          T.s1,s2,s3,... ALL → gw-B
   → no gw sees whole T → decides on            → gw-B sees whole T → correct
     FRAGMENTS → drops errors silently            error/latency/baseline decision
```

### Every Boundary Without Shared Memory Is a Queue

```text
   SHARED MEMORY (context flows free)     NO SHARED MEMORY (inject/extract a carrier)
   ┌──────────────────────────┐          ┌──────────┐  carrier   ┌──────────┐
   │ goroutine / asyncio task  │          │ producer │ ─────────► │ consumer │
   │ promise / same thread     │          │  inject  │ (headers / │  extract │
   │ → ctx propagates          │          │          │  env var / │          │
   └──────────────────────────┘          └──────────┘  workerData)└──────────┘
   free                                   queue · process pool · worker_threads · subprocess
                                          · serverless invoke · gRPC stream  → MUST carry by hand
```

### Exemplars Bridge Detection and Diagnosis

```text
   METRICS (real-time, unsampled)              TRACES (sampled, delayed by decision_wait)
   ┌───────────────────────────┐               ┌────────────────────────────────────┐
   │ p99 latency panel          │  exemplar     │ the actual 4.1s trace               │
   │   • ← clickable dot carries │ ────────────► │   span: db.acquire 4.0s (pool       │
   │     trace_id (recorded      │  one click    │   exhaustion) ← THE answer          │
   │     inside a sampled span)  │               │                                     │
   └───────────────────────────┘               └────────────────────────────────────┘
   DETECT here (alert on metrics)               DIAGNOSE here — IF sampling kept this trace
```

---
