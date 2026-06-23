# Latency and Throughput — Professional Level

> **Roadmap:** [Performance](../README.md) → Latency and Throughput
> *The senior page taught you Little's Law and where tail latency comes from. This page is about owning latency and throughput as production contracts — with an SLO, an error budget, a capacity plan, and a pager that goes off when you're burning the budget too fast. Here "p99 is 180ms" stops being a benchmark number and becomes a number you defend in a review, alert on, and pay for in headroom.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Latency SLOs and Error Budgets](#latency-slos-and-error-budgets)
4. [Where You Measure Decides What You See](#where-you-measure-decides-what-you-see)
5. [Capacity Planning from Throughput Targets](#capacity-planning-from-throughput-targets)
6. [Autoscaling on the Right Signal](#autoscaling-on-the-right-signal)
7. [The Throughput-vs-Latency Business Trade-off](#the-throughput-vs-latency-business-trade-off)
8. [Observability for Tail Latency](#observability-for-tail-latency)
9. [Cost: SLO vs the Dollars of Headroom](#cost-slo-vs-the-dollars-of-headroom)
10. [War Stories](#war-stories)
11. [Decision Frameworks](#decision-frameworks)
12. [Mental Models](#mental-models)
13. [Common Mistakes](#common-mistakes)
14. [Test Yourself](#test-yourself)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)
17. [Further Reading](#further-reading)
18. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Latency and throughput as production SLOs and a capacity discipline — set, measured, alerted, budgeted, and paid for.**

The senior page treated latency and throughput as properties of a system you measure and reason about. At the professional level they become *commitments*. Someone — you, your team, a contract with a customer — has promised that p99 read latency stays under 200ms and that the service sustains 12,000 requests per second at peak. That promise has consequences: an alert when it's at risk, a capacity plan that provisions the headroom to keep it, a budget that says how much breakage is acceptable before you stop shipping features, and a line on an invoice for the machines that hold the line.

None of this is new *theory*. It's Little's Law, percentiles, and queueing — the same physics from the earlier tiers — now wrapped in the operational machinery that turns "fast enough" into something measurable and defensible. The skill here is judgment under those constraints: knowing that you alert on *burn rate*, not on every p99 blip; that you autoscale on concurrency, not CPU; that a batch pipeline and an interactive API want opposite things from the same hardware; and that every nine of latency you promise is paid for in idle headroom. This page is the pragmatic, battle-tested layer.

---

## Prerequisites

- **Required:** [senior.md](senior.md) — Little's Law (`L = λ · W`), why tail latency ≠ average, the coordinated-omission trap, percentile arithmetic.
- **Required:** You've run something in production and watched a dashboard during an incident.
- **Helpful:** You've owned an on-call rotation and tuned (or suffered) an alerting policy.
- **Helpful:** You've sat in a capacity-planning or cost review and had to justify instance counts.

---

## Latency SLOs and Error Budgets

A latency **SLO** (service level objective) is a target stated as a percentile over a window: *"99% of `GET /v1/order` requests complete in under 200ms, measured over a rolling 28-day window."* Three parts matter and people routinely drop one:

- **The indicator (SLI):** what you measure — usually the fraction of requests faster than a threshold. Note the framing: an SLI like "good events / valid events" turns latency into a *ratio*, which composes with error budgets cleanly. "p99 latency" as a raw gauge does not.
- **The threshold:** 200ms. Pick it from user-perceived requirements, not from "what the service currently does." An SLO that just describes current behavior protects nothing.
- **The window and target:** 99% over 28 days. The target's *complement* (1%) is your **error budget** — the amount of "too slow" you're allowed before the SLO is breached.

Phrasing latency as a threshold-ratio SLI is the move that makes everything downstream work:

```
# Prometheus recording rules: latency SLI as a "good/total" ratio
# "good" = requests served faster than the 200ms threshold
- record: job:request_latency_good:ratio_rate5m
  expr: |
    sum(rate(http_request_duration_seconds_bucket{job="order-api", le="0.2"}[5m]))
    /
    sum(rate(http_request_duration_seconds_count{job="order-api"}[5m]))
```

The error budget reframes reliability from "never be slow" (impossible, and the wrong goal) to "you may be slow 1% of the time — spend it deliberately." If you've burned little budget, you can ship risky changes; if you've burned most of it, you freeze features and stabilize. That's the whole point: the budget is a *shared currency* between the people who want velocity and the people who want stability.

### Multi-window, multi-burn-rate alerts

The naive alert — "page me when the 5-minute p99 exceeds 200ms" — is a fatigue machine. It fires on every transient blip and tells you nothing about whether you'll actually breach the SLO. The discipline (straight from the Google SRE workbook) is to alert on **burn rate**: how fast you're consuming the error budget relative to the rate that would exhaust it exactly at the window's end. Burn rate of 1 means you'll spend the whole 28-day budget exactly on schedule; burn rate of 14.4 means you'd exhaust it in ~2 days.

Use **two windows** per alert — a long one for significance, a short one to confirm the burn is *still happening* so the alert resets when the incident ends:

```yaml
# Fast-burn: ~2% of a 28-day budget in 1 hour → page now.
# Long window (1h) for signal, short window (5m) to confirm it's ongoing.
- alert: OrderApiLatencyFastBurn
  expr: |
    (1 - job:request_latency_good:ratio_rate1h) > (14.4 * 0.01)
    and
    (1 - job:request_latency_good:ratio_rate5m) > (14.4 * 0.01)
  for: 2m
  labels: { severity: page }

# Slow-burn: ~10% of budget over 6h → ticket, not a page.
- alert: OrderApiLatencySlowBurn
  expr: |
    (1 - job:request_latency_good:ratio_rate6h) > (6 * 0.01)
    and
    (1 - job:request_latency_good:ratio_rate30m) > (6 * 0.01)
  labels: { severity: ticket }
```

Fast-burn pages a human; slow-burn opens a ticket. The result: you get woken up only when budget is genuinely at risk, and you stop getting paged for a 90-second p99 spike that self-heals.

> **The professional reality:** the value of an SLO is not the number — it's that the number is *agreed, alerted on burn rate, and tied to a feature-freeze policy.* An SLO nobody alerts on and nobody freezes for is a vanity metric. Make it operational or don't bother.

---

## Where You Measure Decides What You See

The single most common way teams lie to themselves about latency is measuring it at the wrong place. **Server-side handler timing systematically under-reports what the user experiences**, because it excludes everything outside the handler:

- **Queue time before the handler runs** — a request sitting in the accept backlog or a worker pool has zero "server time" but plenty of user-felt latency. This is exactly where coordinated omission hides.
- **Load-balancer and network time** — TLS handshake, connection setup, the LB's own queueing under load.
- **The slow tail of connection establishment** — pool exhaustion, DNS, retries.

Measure at the **edge — the load balancer or, better, the client** — and your p99 includes the queueing and connection cost the user actually pays. Measure only in the handler and you'll report a healthy 80ms p99 while users see 400ms, then waste a week "optimizing" code that isn't the problem.

Envoy exposes per-upstream timing that captures the full request lifetime at the edge:

```yaml
# Envoy access log: separate the times so you can attribute the tail.
# %DURATION% = total; %RESPONSE_DURATION% = upstream first byte;
# the gap between them is queue + connection time the handler never sees.
access_log:
  - name: envoy.access_loggers.stdout
    typed_config:
      "@type": type.googleapis.com/envoy.extensions.access_loggers.stream.v3.StdoutAccessLog
      log_format:
        text_format_source:
          inline_string: "total=%DURATION% upstream=%RESPONSE_DURATION% wait=%RESPONSE_TX_DURATION% code=%RESPONSE_CODE%\n"
```

The gap between **total** and **upstream** time *is* the latency your server-side metrics are hiding. When the two diverge under load, you have a queueing problem (more capacity / less concurrency), not a code problem.

> **The principle:** instrument the latency the *user* pays, not the latency the *handler* spends. The further out you measure — handler → server process → load balancer → client RUM — the closer you get to the truth, and the harder it is to fool yourself. The classic disaster is a glowing handler-latency dashboard during an incident where every customer is timing out, because all the latency lives in the queue your handler metric never sees.

---

## Capacity Planning from Throughput Targets

Capacity planning starts from a throughput target and works backward to machines. The arithmetic is Little's Law (`concurrency = throughput × latency`) plus a hard rule about how full you're allowed to run.

Suppose the target is **10,000 RPS at peak**, mean service latency is **40ms**, and one instance saturates around **800 RPS** before latency degrades. Naively you need `10000 / 800 ≈ 13` instances. That number is a trap, because of the queueing knee.

### The 80% rule and why utilization kills latency

As a queue approaches 100% utilization, latency doesn't rise linearly — it explodes. For an M/M/1 queue, response time scales as `1 / (1 − ρ)` where `ρ` is utilization. At 50% load latency is 2× the service time; at 80% it's 5×; at 90% it's 10×; at 95% it's 20×. **The last 20% of utilization buys you a small amount of throughput at the cost of catastrophic tail latency.**

```
Utilization ρ   Latency multiplier (1/(1-ρ))
  50%               2.0×
  70%               3.3×
  80%               5.0×     ← the practical ceiling for latency-sensitive services
  90%              10.0×
  95%              20.0×
  99%             100.0×     ← the cliff
```

So you don't plan to run at 100%; you plan for **headroom**. The common rule is **target ~80% peak utilization** for interactive services — enough efficiency to not waste money, enough slack to absorb a traffic spike, a failed instance, or a GC pause without falling off the latency cliff. Re-doing the math with a 70–80% target and a buffer for instance failure (N+1 or N+2), the 13 instances becomes ~18–20.

The headroom also has to cover **correlated loss**: if you run across 3 availability zones and must survive losing one, every zone carries 1.5× its steady load during a failover — so your per-zone utilization at steady state must be low enough that 1.5× it still sits under 80%.

> **The professional reality:** capacity is not "how many machines handle the load" — it's "how many machines hold the *latency SLO* at peak, with one zone down and headroom for a spike." Sizing to average load, or to 100% utilization, is how you get an incident the first Monday traffic is 20% above forecast.

---

## Autoscaling on the Right Signal

Most autoscaling is configured on **CPU utilization**, and for latency-sensitive services that's frequently the *wrong signal*. CPU tells you the service is busy; it doesn't tell you whether requests are *waiting*. A service can be at 60% CPU and have a queue 500 deep because it's blocked on a downstream dependency, slow I/O, or lock contention — CPU-based autoscaling won't react, and latency craters while the dashboard looks fine.

Scale on a signal that tracks **the thing the user feels**: concurrency or queue depth.

- **Concurrency (in-flight requests):** by Little's Law, in-flight requests = throughput × latency. When latency rises *or* throughput rises, concurrency rises — so it captures both, and it's the load metric that most directly maps to "are we about to violate the SLO." This is why Knative and similar systems default to a concurrency target per pod.
- **Queue depth / queue wait time:** if you have an explicit queue (worker pool, message broker), its depth is the earliest leading indicator of trouble. CPU is a *lagging* indicator; queue depth leads it.

```yaml
# Kubernetes HPA on a custom concurrency metric, not CPU.
# Target ~25 in-flight requests per pod (tune from load tests).
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata: { name: order-api }
spec:
  scaleTargetRef: { apiVersion: apps/v1, kind: Deployment, name: order-api }
  minReplicas: 6
  maxReplicas: 40
  metrics:
    - type: Pods
      pods:
        metric: { name: http_inflight_requests }
        target: { type: AverageValue, averageValue: "25" }
  behavior:
    scaleUp:   { stabilizationWindowSeconds: 0,   policies: [{ type: Percent, value: 100, periodSeconds: 30 }] }
    scaleDown: { stabilizationWindowSeconds: 300, policies: [{ type: Percent, value: 10,  periodSeconds: 60 }] }
```

Note the asymmetric `behavior`: scale **up fast** (0s stabilization, double in 30s) because falling behind on latency is expensive and self-reinforcing; scale **down slow** (5-minute window, 10% steps) to avoid flapping and to keep headroom for the next spike. The cost of an unnecessary pod for five minutes is trivial next to the cost of thrashing.

> **The principle:** autoscale on the signal that *leads* an SLO violation, not the one that *lags* it. Concurrency and queue depth lead; CPU lags. CPU-based scaling on an I/O-bound or dependency-bound service is a classic way to watch latency explode while the autoscaler sits idle because CPU "looks fine."

---

## The Throughput-vs-Latency Business Trade-off

Throughput and latency pull against each other on the same hardware, and which one you optimize is a *business* decision, not a technical default. The lever is **batching** (and its cousins: buffering, larger work units, higher concurrency).

- **Batching raises throughput and hurts latency.** Accumulating 200 records before a flush amortizes per-batch overhead (one network round-trip, one fsync, one transaction) across many items — throughput soars. But the first record in the batch waits for the last one to arrive, so per-item latency rises.
- **Small, eager work units lower latency and hurt throughput.** Flush every record immediately and each one is fast, but you pay the per-operation overhead every time, capping throughput.

This maps cleanly onto two workload classes:

| | Batch / pipeline workload | Interactive / online service |
|---|---|---|
| Primary metric | **Throughput** (records/sec, jobs/hour) | **Tail latency** (p99/p99.9) |
| Tolerates batching? | Yes — bigger batches are better | No — batching adds queueing delay |
| Tuning knob | Maximize batch size, parallelism | Minimize queue depth, bound concurrency |
| GC / JIT posture (Java) | Throughput collector (Parallel GC), warm up | Low-pause collector (ZGC/Shenandoah / G1 tuned) |
| Go posture | High `GOMAXPROCS`, large buffers | Bound goroutine fan-out, tune `GOGC` for pause |
| Failure mode if you pick wrong | Slow pipeline, missed batch SLA | p99 cliff, timeouts, retry storms |

A nightly ETL job that processes 2 billion rows should batch aggressively, run a throughput-oriented GC, and not care that any single row took 8 seconds end-to-end — the SLA is "done by 6am." An order API serving the same data interactively should bound batch size near zero, run a low-pause collector, and treat a single 8-second request as an incident.

The mistake is applying one posture to both. Teams that batch an interactive path "for efficiency" discover they've traded a measurable cost win for an invisible tail-latency loss that shows up as customer complaints. Teams that run an interactive-tuned config on a batch pipeline leave half their throughput on the floor and miss the batch window.

> **The professional reality:** "make it faster" is ambiguous until you name the metric. Ask *which one the business is paying for* — throughput (cost per unit of work, deadline) or tail latency (user-perceived responsiveness) — and tune for that one, accepting the cost on the other. Optimizing both at once on shared hardware is usually a sign you haven't decided.

---

## Observability for Tail Latency

A p99 number tells you that *something* is slow 1% of the time. It does not tell you *what*, and averaged metrics actively hide it — the slow 1% is invisible in a mean and barely moves the p50. To find the culprit you need to attribute the tail to a component, and that requires distributed tracing plus the link between metrics and traces.

### Tracing to attribute the tail

A request that fans out to five downstream services has a p99 that's the max-ish of its parts (the [tail-at-scale](https://research.google/pubs/the-tail-at-scale/) amplification). Distributed tracing (OpenTelemetry → Jaeger/Tempo) breaks the request into spans so you can see *which* span owns the latency for the slow requests specifically — the auth check, the DB query, the serialization, the downstream call that occasionally takes 2 seconds.

The trap is *sampling*: head-based sampling at 1% will, by definition, miss almost all of your slow tail, because slow requests are rare. Use **tail-based sampling** — buffer spans, decide *after* the trace completes, and keep the slow ones:

```yaml
# OpenTelemetry Collector: keep every trace slower than 500ms (and all errors),
# plus a small baseline sample of the fast ones for comparison.
processors:
  tail_sampling:
    decision_wait: 10s
    policies:
      - name: slow-traces
        type: latency
        latency: { threshold_ms: 500 }
      - name: errors
        type: status_code
        status_code: { status_codes: [ERROR] }
      - name: baseline
        type: probabilistic
        probabilistic: { sampling_percentage: 1 }
```

### Exemplars: the metrics → traces jump

The fastest tail investigation pattern is the **exemplar** — a metric data point annotated with a trace ID of an actual request that landed in that bucket. In Grafana you see a p99 latency spike on a histogram, click the exemplar dot sitting on the spike, and land directly in the trace of a request that *was* slow at that moment. No guessing, no correlating timestamps by hand. Prometheus histograms support exemplars; OpenTelemetry attaches them automatically when a span is active during a metric recording.

> **The professional discipline:** an aggregate latency metric is a smoke detector, not a diagnosis. The workflow is: SLI/burn-rate alert fires → look at the p99 histogram → click an **exemplar** into a representative slow **trace** → read the spans to find the component that owns the tail → fix *that*. Without exemplars and tail-based sampling, you're correlating dashboards by eye during an incident — slow and error-prone exactly when you can least afford it.

---

## Cost: SLO vs the Dollars of Headroom

Every nine of latency reliability is bought with idle capacity, and the relationship is non-linear — the same shape as the utilization curve, inverted. Defending a tight p99 means running at lower utilization, which means more machines doing less work each.

A concrete sketch: a service needs 10 instances to handle peak load *on average*. To hold p99 < 200ms (target ~80% utilization with failover headroom) it needs ~16. To hold p99.9 < 200ms — squeezing the slow 0.1% — it might need ~24, because you're now provisioning against the rare correlated spikes that only show up at the far tail. That's a 50% cost jump from p99 to p99.9 for a latency improvement most users will never perceive.

```
SLO tightness        Approx instances    Relative $    What it buys
─────────────────────────────────────────────────────────────────────
p99 < 200ms              16                1.0×         the meaningful guarantee
p99.9 < 200ms            24               ~1.5×         the rare-tail guarantee
p99.99 < 200ms           40+              ~2.5×+        usually not worth it
```

The discipline is to set the SLO at the tightness the business actually needs and *no tighter*, because each additional nine is paid in standing headroom forever. Often the right answer is a *looser latency SLO with a tight availability SLO*, or graceful degradation (shed load, serve a cached/cheaper response) at the tail instead of provisioning to never hit it.

> **The professional reality:** "what should our p99 target be?" is partly a finance question. p99 → p99.9 can be a 50% capacity bill for a guarantee most users can't tell from the looser one. Tie the SLO to user-perceived need and the marginal cost of the headroom — not to "tighter is better." Over-tight SLOs are a silent, recurring tax.

---

## War Stories

**The GC pause that owned p99.** A Java order service held a clean p50 of 25ms but a p99 of 400ms that no code path explained. Tracing showed the slow requests weren't slow in any *span* — they were slow in the *gaps between* spans. The culprit was G1 stop-the-world pauses: a request unlucky enough to arrive during a ~300ms pause ate the whole pause. The fix wasn't application code; it was switching to a low-pause collector (ZGC) and reducing allocation rate to make pauses rarer. The lesson: tail latency frequently lives *outside your code* — in GC, scheduler preemption, or the runtime — and only tracing the gaps, not the spans, reveals it.

**The connection-pool knee.** A service scaled fine to 6,000 RPS, then p99 went vertical at ~6,200 with CPU still at 55%. CPU-based autoscaling never fired. The bottleneck was a database connection pool capped at 20: past ~6,000 RPS, requests queued *waiting for a connection*, and that wait was invisible to both CPU metrics and handler timing (the handler clock started *after* it got a connection). The fix was raising the pool, adding a connection-acquire-time metric, and switching autoscaling to concurrency. The lesson: the knee is a queue you weren't measuring, and CPU won't show it.

**The retry storm that collapsed throughput.** A downstream dependency slowed slightly, pushing some calls past the client timeout. Clients retried. Retries added load to the already-struggling dependency, which slowed further, which caused *more* timeouts and *more* retries — a positive feedback loop that drove the dependency from 8,000 RPS of useful work to 14,000 RPS of mostly-doomed retries, collapsing *goodput* to near zero while throughput-of-requests looked high. The fix: retry budgets (cap retries at, say, 10% of requests), exponential backoff with jitter, and circuit breaking. The lesson: naive retries turn a small latency blip into a throughput collapse; measure *goodput* (successful work), not raw request rate.

**The handler dashboard that lied through an outage.** During a partial outage, the team's primary latency dashboard — handler timing — stayed green at 90ms p99 while customers reported total timeouts. All the latency was in the accept queue *before* the handler ran; the handler only timed work it actually started. They were debugging the wrong layer for 40 minutes. After the incident they moved the SLI to the load-balancer (`%DURATION%` in Envoy). The lesson: measure at the edge, or your dashboard will reassure you while users burn.

---

## Decision Frameworks

**Throughput or tail latency — which do I optimize? Ask:**
- Is this an interactive/online path a user waits on? → optimize **tail latency**; bound batch size and concurrency; low-pause GC.
- Is this a batch/pipeline/async path with a deadline? → optimize **throughput**; batch aggressively; throughput GC; per-item latency doesn't matter.
- Is it both (a shared service)? → split the paths or pick the metric the *business pays for* and accept the cost on the other.

**What signal should autoscaling use? Ask:**
- Is the service CPU-bound with no significant I/O or downstream waits? → CPU is acceptable.
- Does it wait on DBs, queues, or downstreams? → scale on **concurrency / in-flight requests** or **queue depth**, not CPU.
- Do you have an explicit queue? → its **depth/wait time** is the earliest signal; prefer it.

**Where do I measure latency for the SLO? Default to:**
- The **load balancer** (Envoy `%DURATION%`) at minimum; **client RUM** if you can. Handler timing is for *diagnosis*, never for the SLO.

**How tight should the latency SLO be? Ask:**
- What latency do users actually perceive / require? → set the threshold there, not at current performance.
- What does the next nine cost in standing headroom? → if p99 → p99.9 ~doubles the bill for an imperceptible gain, stop at p99 and degrade gracefully at the tail.

**How do I alert on latency? Default to:**
- **Multi-window, multi-burn-rate** on a threshold-ratio SLI. Fast-burn → page; slow-burn → ticket. Never page on a raw 5-minute p99 gauge.

---

## Mental Models

- **An SLO is a contract, not a number.** Its value is that it's agreed, alerted on *burn rate*, and tied to a feature-freeze policy. A p99 target nobody freezes for is decoration.

- **You measure latency where the user pays it, not where the handler spends it.** Every layer outward — handler → process → load balancer → client — gets closer to the truth and harder to fool yourself with. Queue time is real latency your handler clock can't see.

- **Utilization buys throughput and sells latency, non-linearly.** Latency ≈ `1/(1−ρ)`. The last 20% of utilization is the most expensive 20% in tail latency. Plan headroom; ~80% is the practical ceiling for interactive services.

- **Autoscale on the leading signal.** Concurrency and queue depth *lead* an SLO violation; CPU *lags* it. On an I/O- or dependency-bound service, CPU-based scaling watches latency explode and does nothing.

- **Throughput and latency trade through batching.** Bigger work units = more throughput, more latency. Decide which one the business is buying and tune for it; trying to maximize both on shared hardware means you haven't chosen.

- **The tail lives in the gaps.** A clean p50 with an ugly p99 is usually GC, scheduling, queueing, or a connection-pool knee — not your hot path. Trace the gaps between spans, not just the spans.

---

## Common Mistakes

1. **Measuring latency in the handler and calling it the SLO.** Handler timing excludes queue, connection, and LB time — exactly where the tail lives under load. Measure at the load balancer or client; use handler timing only for diagnosis.

2. **Paging on raw p99 instead of burn rate.** A 5-minute p99 alert fires on every transient blip and tells you nothing about SLO risk. Use multi-window, multi-burn-rate alerts on a threshold-ratio SLI.

3. **Sizing capacity to average load or 100% utilization.** Latency explodes near saturation (`1/(1−ρ)`). Plan ~80% peak with failover headroom, or you fall off the cliff the first time traffic beats forecast.

4. **Autoscaling on CPU for an I/O- or dependency-bound service.** CPU lags; latency craters while the autoscaler sleeps. Scale on concurrency or queue depth.

5. **Batching an interactive path "for efficiency."** You trade a measurable cost win for an invisible tail-latency loss that surfaces as customer complaints. Batch the pipelines, not the user-facing path.

6. **Head-sampling traces at 1%.** You'll miss almost the entire slow tail, which is the only part you wanted. Use tail-based sampling that keeps the slow and error traces.

7. **Chasing p99.9 / p99.99 by reflex.** Each nine is paid in permanent idle headroom — p99 → p99.9 can be ~1.5× the bill. Set the SLO to user-perceived need and degrade gracefully at the far tail.

8. **Measuring request rate instead of goodput.** During a retry storm, request throughput looks high while *useful* work collapses. Alert on successful work, with retry budgets and circuit breakers in place.

---

## Test Yourself

1. Why is a "5-minute p99 > 200ms" alert a poor SLO alert, and what does a multi-window multi-burn-rate alert do instead?
2. Your handler-latency dashboard shows a healthy 80ms p99 during an incident where customers report timeouts. What's almost certainly happening, and where should you have been measuring?
3. A service saturates one instance at 800 RPS and you need 10,000 RPS. Why is `10000/800 ≈ 13` instances the wrong answer, and roughly what should it be?
4. A service is at 55% CPU but its p99 just went vertical. What signal should autoscaling have used, and why didn't CPU react?
5. You're asked to "make the nightly ETL and the order API both faster." How do these two goals differ, and what's the single lever that trades between them?
6. You see a p99 spike on a Grafana histogram. Describe the fastest path from that spike to the component responsible for it.
7. Your product owner wants p99.9 instead of p99. What's the hidden cost, and when is it not worth paying?

<details>
<summary>Answers</summary>

1. A 5-minute p99 alert fires on every transient blip and carries no information about whether you'll actually breach the SLO, so it's pure fatigue. A **multi-window multi-burn-rate** alert fires only when you're consuming the error budget fast enough to breach it (e.g., burn rate 14.4 = exhaust the 28-day budget in ~2 days), and the short confirming window makes it reset when the incident ends. Fast-burn pages; slow-burn tickets.
2. The latency is in the **accept/queue/connection time before the handler runs**, which handler timing never sees. Measure at the **load balancer** (Envoy `%DURATION%`) or **client RUM** so the SLI includes queueing and connection cost — the latency the user actually pays.
3. 13 assumes you can run instances at 100% utilization, but latency explodes as `1/(1−ρ)` near saturation — at 95% it's ~20× service time. You plan for headroom (~80% peak) plus failover (lose a zone → 1.5× per-zone load) plus instance-failure buffer (N+1/N+2). That pushes it to roughly **18–20** instances.
4. It should have used **concurrency (in-flight requests) or queue depth**. CPU was 55% because the requests were *waiting* (e.g., on a connection pool or downstream), not computing — CPU is a lagging signal for I/O/dependency-bound work, so it never crossed the scale threshold while latency cratered.
5. The ETL wants **throughput** (records/sec, "done by 6am") and tolerates large batches and high per-item latency; the order API wants **tail latency** and is hurt by batching. The single lever is **batch/work-unit size**: bigger batches raise throughput and raise latency; small eager units lower latency and lower throughput. Tune each path oppositely.
6. Click the **exemplar** dot on the histogram spike — it carries the trace ID of an actual request in that latency bucket — to jump straight into a representative **slow trace**, then read the spans (relying on **tail-based sampling** having kept the slow ones) to find which component owns the tail. No timestamp correlation by hand.
7. Each additional nine is paid in **permanent idle headroom** — p99 → p99.9 can be ~1.5× the instance count (and bill) because you're provisioning against rare correlated tail spikes. It's not worth it when the improvement is imperceptible to users; prefer a looser latency SLO with graceful degradation (load shedding, cheaper/cached responses) at the far tail.

</details>

---

## Cheat Sheet

```
LATENCY SLO
  SLI as a ratio:  good (faster than threshold) / valid   ← composes with budgets
  SLO:             99% of GET /order < 200ms over 28d
  error budget:    1% — spend it deliberately; freeze features when burned

BURN-RATE ALERTS (multi-window, multi-burn)
  fast burn  14.4× over 1h AND 5m   → PAGE  (≈2% of 28d budget in 1h)
  slow burn   6×   over 6h AND 30m  → TICKET
  NEVER page on a raw 5-minute p99 gauge

WHERE TO MEASURE  (closer to user = truer)
  client RUM > load balancer (Envoy %DURATION%) > server process > handler
  handler timing = DIAGNOSIS ONLY, never the SLO (misses queue + conn time)

CAPACITY  (latency ≈ 1/(1−ρ))
  ρ=80% → 5× service time   ρ=95% → 20×   ρ=99% → 100×
  plan ~80% peak + failover (zone down = 1.5× load) + N+1 buffer
  RULE: size to hold the SLO at peak, not to handle average load

AUTOSCALE on the LEADING signal
  concurrency (in-flight = λ·W) or queue depth   ← leads SLO breach
  CPU lags; useless for I/O/dependency-bound services
  scale UP fast, scale DOWN slow (avoid flap)

THROUGHPUT vs LATENCY  (lever = batch size)
  batch / pipeline  → maximize throughput, throughput GC, ignore per-item latency
  interactive       → minimize tail latency, low-pause GC, bound concurrency

TAIL OBSERVABILITY
  tail-based sampling (keep slow + errors), NOT 1% head sampling
  exemplar (metric→trace) = click the p99 spike → land in a slow trace
  tail lives in the GAPS (GC, queue, pool knee), not the spans

COST
  each nine = permanent idle headroom; p99→p99.9 ≈ 1.5× the bill
  set SLO to user-perceived need; degrade gracefully at the far tail
```

---

## Summary

- A latency **SLO** is a threshold-ratio SLI over a window, with its complement as an **error budget** you spend deliberately and freeze features to protect. Alert on **multi-window, multi-burn-rate** — page on fast burn, ticket on slow burn — never on a raw 5-minute p99 gauge.
- **Measure where the user pays the latency**: the load balancer (Envoy `%DURATION%`) or client, not the handler. Handler timing hides queue and connection time — exactly where the tail lives under load — and will glow green through an outage.
- **Plan capacity to hold the SLO at peak**, not to handle average load. Latency scales as `1/(1−ρ)`, so size to ~80% peak utilization with failover and instance-failure headroom — the last 20% of utilization is the most expensive in tail latency.
- **Autoscale on the leading signal** — concurrency (in-flight = `λ·W`) or queue depth — not CPU, which lags and ignores I/O- and dependency-bound waits.
- **Throughput vs tail latency is a business choice traded through batch size**: pipelines maximize throughput; interactive services minimize the tail. Pick the metric the business pays for and accept the cost on the other.
- **Attribute the tail with tracing and exemplars**: tail-based sampling keeps the slow traces, exemplars jump metrics → traces, and the tail usually lives in the gaps (GC, queueing, pool knees), not the spans.
- **Every nine of latency is paid in standing headroom.** Set the SLO to user-perceived need; degrade gracefully at the far tail rather than provisioning to never hit it.

You can now own latency and throughput as production contracts — set, measured at the right place, alerted on burn rate, planned for with headroom, and priced. The final tier — [interview.md](interview.md) — distills the whole topic into the questions that test whether someone genuinely understands it.

---

## Further Reading

- [Google SRE Workbook — Alerting on SLOs](https://sre.google/workbook/alerting-on-slos/) — the definitive treatment of multi-window, multi-burn-rate alerting.
- [The Tail at Scale](https://research.google/pubs/the-tail-at-scale/) — Dean & Barroso on why p99 amplifies across fan-out and how to fight it.
- [The USE Method and Systems Performance](https://www.brendangregg.com/usemethod.html) — Brendan Gregg on utilization, saturation, and the queueing cliff.
- [OpenTelemetry tail-based sampling](https://opentelemetry.io/docs/concepts/sampling/) — keeping the slow traces you actually need.
- [Prometheus histograms and exemplars](https://prometheus.io/docs/concepts/metric_types/#histogram) — the metrics→traces link for tail investigation.
- [Envoy access logging](https://www.envoyproxy.io/docs/envoy/latest/configuration/observability/access_log/usage) — `%DURATION%` vs upstream timing for edge-measured latency.

---

## Related Topics

- [junior.md](junior.md) — what latency and throughput are, percentiles, and why the average lies.
- [senior.md](senior.md) — Little's Law, the p99 trap, coordinated omission, where tail latency comes from.
- [interview.md](interview.md) — the questions that probe whether you can set, measure, and defend a latency SLO.
- [07 — Performance Budgets and Regression Testing](../07-performance-budgets-and-regression-testing/professional.md) — keeping the latency you fought for from regressing, CI gates, and statistical thresholds.
