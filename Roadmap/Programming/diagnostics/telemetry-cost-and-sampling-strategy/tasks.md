# Telemetry Cost & Sampling Strategy — Hands-On Exercises

> **Topic:** [Telemetry Cost & Sampling Strategy Roadmap](README.md)
> **Focus:** Practical exercises that take you from "I can set a 10% sampler" to "I can design a per-service cost budget and a sampling policy that keeps the fidelity floor at 100% while cutting the bill in half."

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

You cannot learn cost control from reading any more than you can learn to swim from a manual. You learn it by setting a 10% sampler and counting whether 1-in-10 traces actually arrive, by adding a `user_id` label and watching `prometheus_tsdb_head_series` climb by 50,000, and by writing a tail-sampling policy that keeps every error and then *proving* with synthetic traffic that no error was dropped. The exercises below are tiered. The **Warm-Up** band trains the mechanics — configure a probabilistic sampler, compute series count on paper, name the cost driver for an item — so the arithmetic of cardinality and the shape of a collector config are reflex, not a copy-paste. The **Core** band is the heart: tail sampling that keeps the fidelity floor, reproducing *and fixing* a cardinality explosion, reconstructing true totals from a sampled stream (including mixed rates), and dropping noise with a filter. The **Advanced** band drops you into the senior-versus-middle situations — retention/downsampling tiers, consistent sampling across services so traces don't come out half-empty, a two-tier collector that routes by `trace_id`, and load-testing the tail sampler to its OOM point. The **Capstone** stops being about processors and becomes strategy: a real cost budget and policy-as-code for a small fleet, with a spend alert and a written trade-off memo for stakeholders.

Do not skip ahead. The Capstone assumes you can write a `tail_sampling` block from memory, that you know an error trace must *never* be sampled, and that you instinctively reach for `1/sample_rate` before reporting any count off sampled data. If you are still unsure why a trace's spans must converge on one collector, you will design a topology that silently breaks tail sampling. Work each band end-to-end. If a task takes longer than its stated time, write down what blocked you — that note tells you which level doc to re-read.

For background reading at each level: see [junior.md](junior.md), [middle.md](middle.md), [senior.md](senior.md), [professional.md](professional.md), and [interview.md](interview.md).

A note on tooling. You need the **OpenTelemetry Collector** (a single static binary, or `otel/opentelemetry-collector-contrib` in Docker — the *contrib* image, because `tail_sampling` and `loadbalancing` live there, not in core). For the metric tasks, a local **Prometheus**; for trace tasks, a tracing backend (**Jaeger** or **Tempo**) is nice but optional — for most exercises you can point the collector's `debug`/`logging` exporter at stdout and count what survives. A small **load generator** completes the kit: a `for` loop with `curl`, `tracegen` (ships with the collector contrib repo), or a 30-line script that emits OTLP spans with `status` and `duration` you control. Everything here runs on a laptop. Throughout, the inviolable rule from [junior.md](junior.md) holds: **errors, audit/security events, SLO signals, and billing data are never sampled.** Several tasks exist specifically to make you prove that floor held. The [`observability-stack`](README.md) and [`monitoring-alerting`](README.md) skills are the strategic companions to these mechanics — reach for them when a task asks you to design alerts or a backend topology rather than just turn a knob.

---

## Warm-Up

These are 15-to-30-minute exercises. The goal is fluency with the mechanics — configure, count, classify — not insight. If a Warm-Up takes more than an hour, stop and re-read the corresponding section of [junior.md](junior.md).

### Task 1: Configure 10% head sampling and verify the ratio

**Goal.** Stand up an OTel Collector with `probabilistic_sampler` at 10% and confirm that roughly 1-in-10 traces survive.

**Steps.**
1. Write a collector config with a probabilistic sampler in the traces pipeline:
   ```yaml
   receivers:
     otlp:
       protocols: { grpc: { endpoint: 0.0.0.0:4317 } }
   processors:
     probabilistic_sampler:
       sampling_percentage: 10     # keep ~10% of traces, blindly
     batch: {}
   exporters:
     debug: { verbosity: basic }   # prints a per-batch span count to stdout
   service:
     pipelines:
       traces:
         receivers:  [otlp]
         processors: [probabilistic_sampler, batch]
         exporters:  [debug]
   ```
2. Send 1,000 traces (use `tracegen -traces 1000`, or a loop that emits one OTLP span each).
3. Count how many spans the `debug` exporter reports.

**Hints.**
- The contrib image is required: `docker run otel/opentelemetry-collector-contrib`.
- `probabilistic_sampler` hashes the `trace_id`, so the decision is deterministic per trace — you will not get *exactly* 100, but you should land near it.
- Increase the sample to a larger N if the variance bothers you; the law of large numbers is the point.

**Acceptance / What you should see.** The collector exports on the order of 100 traces out of 1,000 (roughly 80–120 is normal sampling variance). You can articulate that the decision was made *blind* — the sampler had no idea whether any of those traces errored.

### Task 2: Compute series count on paper, then add `user_id`

**Goal.** Internalise that cardinality *multiplies* by doing the arithmetic before any tool does it for you.

**Steps.**
1. For the histogram `http_request_duration_seconds` (12 buckets + `_sum` + `_count` ≈ **14 series** per label combination), with labels `method` (4 values) × `status_class` (5 values) × `route` (25 values), compute the total series count.
2. Now add a `user_id` label for **200,000** users. Recompute.
3. Write one sentence on why the answer is a product, not a sum.

**Hints.**
- Series = base_series × ∏(value counts per label).
- The `user_id` factor does not *add* 200,000 — it *multiplies* the existing total by 200,000.
- If you can't enumerate a label's values on a whiteboard, it's a cardinality bomb.

**Acceptance / What you should see.**
- Before: `14 × 4 × 5 × 25 = 7,000` series — fine.
- After: `7,000 × 200,000 = 1,400,000,000` series — 1.4 billion. The TSDB is dead.
- Your sentence names the multiplicative nature as the reason "one harmless label" is never harmless.

### Task 3: Name the cost driver and the fix for each item

**Goal.** Map any telemetry item to its driver (cardinality / volume / volume×spans) and the correct lever.

**Steps.** For each item, write `{driver}` and `{first fix}`:
```
1.  a `user_id` label on a metric, 500k users
2.  DEBUG logging left on in production
3.  100% tracing of a 40-span checkout flow at 30k rps
4.  a metric label holding the full request URL (with query string)
5.  90-day retention of full-resolution logs
6.  a `trace_id` label added to a metric "for correlation"
7.  fat JSON log lines with a 2 KB stack trace on every INFO
8.  a deep trace where each of 6 services adds 100% of its spans
```

**Hints.**
- Metrics fail through *cardinality*; logs through *volume* (bytes × retention); traces through *volume × spans*.
- Items 1, 4, 6 are all the same disease (identity-as-label) — the fix is to move identity to logs/traces/exemplars.
- Match the lever to the driver: shortening log retention does nothing for a metrics-cardinality bill.

**Acceptance / What you should see.** 1/4/6 → cardinality → drop the label / move identity off metrics. 2/5/7 → volume → level control / retention tiers / field pruning. 3/8 → volume×spans → head + tail sampling. You did not propose a retention change to fix a cardinality problem.

---

## Core

These tasks are 1-to-3 hours each. They require you to combine a collector, a load generator, and a critical reading of the output, and to produce a written explanation. If you can do all of them comfortably, you're at the middle level.

### Task 4: Tail-sample — keep all errors, all slow traces, 1% of the rest

**Goal.** Configure tail-based sampling that keeps **100% of errors**, **100% of traces slower than 2s**, and **1% of normal traffic**, then prove the policy with synthetic traces.

**Steps.**
1. Configure the tail sampler:
   ```yaml
   processors:
     tail_sampling:
       decision_wait: 10s          # buffer each trace up to 10s before deciding
       num_traces: 100000          # cap on traces held in memory
       expected_new_traces_per_sec: 2000
       policies:
         - name: keep-all-errors
           type: status_code
           status_code: { status_codes: [ERROR] }     # fidelity floor — 100%
         - name: keep-slow-traces
           type: latency
           latency: { threshold_ms: 2000 }            # 100% of traces > 2s
         - name: sample-the-rest
           type: probabilistic
           probabilistic: { sampling_percentage: 1 }  # 1% of everything else
   service:
     pipelines:
       traces:
         receivers:  [otlp]
         processors: [tail_sampling, batch]
         exporters:  [debug]
   ```
2. Generate a controlled mix: 10,000 normal traces (OK, fast), 50 error traces (`status=ERROR`), 50 slow traces (root span duration > 2s).
3. Tag each synthetic trace with an attribute (e.g. `kind=normal|error|slow`) so you can count survivors by class in the exporter output.

**Hints.**
- A trace is "ERROR" if its **span status** is ERROR — set the status on the root span, not just an HTTP attribute, or the `status_code` policy won't match.
- Policies are OR'd: a trace kept by *any* policy survives. That's why errors are never lost even though the rest is at 1%.
- Keep `decision_wait` longer than your slowest synthetic trace, or a slow trace finishes after the decision and is missed.

**Acceptance / What you should see.** All 50 error traces survive. All 50 slow traces survive. Roughly 100 of the 10,000 normal traces survive (1%). Total kept ≈ 200. You can state the kept fraction (~2%) and confirm zero errors and zero slow traces were dropped — the fidelity floor held.

### Task 5: Reproduce a cardinality explosion, then fix it

**Goal.** Blow up a local Prometheus with a `user_id` label, watch the series count climb, then collapse it with a collector `attributes/delete` *or* a Prometheus `metric_relabel_configs`, and confirm the drop.

**Steps.**
1. Emit a counter with a `user_id` label and drive traffic with thousands of distinct values (loop `curl .../do?user=$(uuidgen)`, or generate IDs in code). Aim for ≥ 50,000 distinct values.
2. Watch the damage: `prometheus_tsdb_head_series` over time, and `topk(5, count by (__name__)({__name__=~".+"}))` to confirm your metric dominates.
3. **Fix at the collector** by deleting the label before export:
   ```yaml
   processors:
     attributes/drop-userid:
       actions:
         - key: user_id
           action: delete
   ```
   **or fix at Prometheus** with a scrape-time relabel:
   ```yaml
   metric_relabel_configs:
     - regex: user_id
       action: labeldrop
   ```
4. Reload and re-measure the series count for that metric.

**Hints.**
- `labeldrop` removes a label by name post-scrape; the collector `delete` removes it pre-export — defence in depth means doing both in a real system.
- Reload Prometheus with `kill -HUP <pid>` or `--web.enable-lifecycle` + `POST /-/reload`.
- Series, not samples, drive TSDB RAM — that's why the head-series gauge is the one to watch.

**Acceptance / What you should see.** Before the fix, the metric carries ~50,000 series and tops the `topk` query; `prometheus_tsdb_head_series` jumped accordingly. After the fix, the metric collapses to a handful of series. You can write one sentence on where per-user drill-down now lives (a trace/log attribute or wide-event store — never the TSDB).

### Task 6: Reconstruct true totals from a sampled stream

**Goal.** Compute adjusted counts: turn a kept-count plus a sample rate back into the true total — first for a single rate, then for a **mixed-rate** stream.

**Steps.**
1. **Single rate.** You head-sampled at **1%** and counted **4,000** kept "checkout" traces in an hour. Reconstruct the true total.
2. **Mixed rate.** Your tail policy keeps errors at **100%** (weight 1) and normal traffic at **1%** (weight 100). In one hour you kept **300 error** traces and **5,000 normal** traces. Reconstruct (a) the true normal-traffic count, (b) the true error count, and (c) the true grand total.
3. Write the general formula and explain why a naive "kept_total × 100" would be wrong here.

**Hints.**
- Adjusted count for one rate: `kept × (1 / sample_rate)`.
- For mixed rates, each kept item carries weight `1 / sample_rate`; the true total is the **Σ of (1 / sample_rate)** across all kept items — equivalently, sum each class's adjusted count.
- Errors are sampled at 100%, so their `1/sample_rate = 1` — they count as themselves, never multiplied.

**Acceptance / What you should see.**
- Single rate: `4,000 × (1 / 0.01) = 4,000 × 100 = 400,000` checkouts.
- Mixed rate:
  - Normal: `5,000 × (1 / 0.01) = 500,000`.
  - Errors: `300 × (1 / 1.00) = 300`.
  - Grand total: `500,000 + 300 = 500,300`.
- You can state why `(300 + 5,000) × 100 = 530,000` is wrong: it inflates the errors 100× even though they were never sampled. The error rate from the naive number (30,000 / 530,000 ≈ 5.7%) is also wrong; the correct rate is `300 / 500,300 ≈ 0.06%`.

### Task 7: Drop noisy health-check spans with a filter

**Goal.** Use the `filter` processor to drop spans you never want to pay for — health checks and readiness probes — before they reach the backend.

**Steps.**
1. Identify the noise: spans named `GET /healthz`, `GET /readyz`, or with `http.target` matching `/health.*`.
2. Add a filter to the traces pipeline:
   ```yaml
   processors:
     filter/drop-health:
       error_mode: ignore
       traces:
         span:
           - 'name == "GET /healthz"'
           - 'name == "GET /readyz"'
           - 'attributes["http.target"] != nil and IsMatch(attributes["http.target"], "^/health")'
   service:
     pipelines:
       traces:
         processors: [filter/drop-health, tail_sampling, batch]
   ```
3. Send a mix of real and health-check spans and count what survives.

**Hints.**
- The `filter` processor uses **OTTL** conditions; a span matching *any* listed condition is dropped.
- Put the filter **before** `tail_sampling` so health spans never consume the decision buffer.
- Don't filter so aggressively you blind your uptime check — health probes you alert on belong in *metrics*, not dropped entirely. Filter the *trace* noise, keep the *signal* elsewhere.

**Acceptance / What you should see.** Health-check spans no longer appear in the exporter output; real request spans pass through untouched. You can explain why filtering before sampling saves both buffer memory and export cost.

---

## Advanced

These tasks are 4-to-8 hours each. They reward methodical design, not raw speed. Several have no single right answer — they have defensible writeups.

### Task 8: Build a retention/downsampling tier

**Goal.** Stop paying full-resolution prices for old data. Build a downsampling + retention strategy: at minimum a Prometheus **recording rule** that pre-aggregates high-resolution data plus a retention policy; ideally a Mimir/Thanos hot-warm-cold setup.

**Steps.**
1. Write a recording rule that downsamples an expensive query into a cheap stored series:
   ```yaml
   groups:
     - name: downsample-latency
       interval: 1m
       rules:
         - record: job:http_request_duration_seconds:p99_5m
           expr: |
             histogram_quantile(0.99,
               sum by (job, le) (rate(http_request_duration_seconds_bucket[5m])))
   ```
2. Set a retention policy: keep raw 15s-resolution data 15 days; keep the recorded 1m series longer (e.g. via `--storage.tsdb.retention.time` for raw, and the recorded series in a longer-retention store, or a Thanos/Mimir compactor with downsampling at 5m/1h).
3. Measure the storage/series cost of the recorded series versus querying raw, and the query latency difference.

**Hints.**
- A recording rule moves cost from *query time* (recomputed on every dashboard load) to a fixed, predictable *write* — the recorded series is small and constant.
- In Thanos/Mimir, the compactor produces 5m and 1h downsamples; dashboards over long ranges read the coarse blocks automatically.
- Never downsample the signals you *alert* on at the resolution you alert at — coarsening a 1m latency SLO to 1h hides the breach.

**Acceptance / What you should see.** A dashboard panel reads the recorded series and renders far faster than the raw `histogram_quantile`. Old data costs materially less to store at coarse resolution. You can defend which series you left at full resolution (alerting/SLO inputs) and why.

### Task 9: Consistent sampling across two services

**Goal.** Make two services agree on the keep/drop decision for the same `trace_id` so a trace is never *half-sampled* (kept in service A, dropped in B → a broken, gap-ridden trace).

**Steps.**
1. Run two services, A → B, propagating W3C `traceparent` across the hop.
2. Configure **consistent probabilistic sampling** keyed on `trace_id`, so the hash-based decision is identical in both. With OTel head sampling, use a `TraceIDRatioBased` sampler with `ParentBased` so a child honours the parent's decision; with collector-side `probabilistic_sampler`, the `trace_id` hash makes the decision deterministic for a given rate.
   ```yaml
   processors:
     probabilistic_sampler:
       sampling_percentage: 10
       hash_seed: 22        # SAME seed on every collector → same decision
   ```
3. Send many traces and inspect the kept ones for completeness (both A and B spans present).

**Hints.**
- `ParentBased(TraceIDRatioBased)` is the SDK recipe: the root decides by ratio, children inherit — no service re-rolls the dice.
- The **`hash_seed` must match** across all collectors, or two collectors hash the same `trace_id` to different decisions and you get half-traces.
- Inconsistent sampling is the classic "why is my distributed trace missing the downstream half?" bug.

**Acceptance / What you should see.** Every kept trace contains spans from *both* services — zero half-sampled traces. You can demonstrate that flipping the seed on one collector immediately produces broken traces, proving the seed/consistency requirement.

### Task 10: Two-tier collector — agent → gateway, route by `trace_id`

**Goal.** Build the topology that makes tail sampling correct at scale: lightweight **agents** receive spans and forward them with a `loadbalancing` exporter keyed on `trace_id` to a tier of **gateway** collectors, so all spans of one trace land on the same gateway that runs `tail_sampling`.

**Steps.**
1. **Agent** config — no sampling, just route by trace ID:
   ```yaml
   exporters:
     loadbalancing:
       routing_key: traceID          # all spans of a trace → same gateway
       protocol:
         otlp: { tls: { insecure: true } }
       resolver:
         static:
           hostnames: [gateway-1:4317, gateway-2:4317]
   service:
     pipelines:
       traces:
         receivers:  [otlp]
         processors: [batch]
         exporters:  [loadbalancing]
   ```
2. **Gateway** config — the tail sampler from Task 4 runs here, on whole traces.
3. Send traces from multiple agent instances and confirm each gateway sees *complete* traces.

**Hints.**
- Tail sampling needs the **whole trace** at one decision-maker; the `loadbalancing` exporter's `routing_key: traceID` is what guarantees that, not luck.
- Run two gateways and verify a trace's spans never split across them.
- This is why you cannot freely round-robin spans across collectors — round-robin would scatter a trace's spans and make every tail decision wrong.

**Acceptance / What you should see.** Each gateway's tail sampler receives complete traces; no trace's spans are split across gateways. The tail policy (errors/slow/1%) still holds. You can explain why `routing_key: traceID` is mandatory for correct tail sampling in a fleet.

### Task 11: Add `memory_limiter` and load-test to the OOM point

**Goal.** Find where the tail-sampling collector falls over, then make it shed load gracefully instead of OOM-ing — exactly when you need it most.

**Steps.**
1. Without a limiter, load-test the Task 4 collector with rising trace rate (e.g. `tracegen` ramping rps) and watch RSS climb until it OOMs. Note the rate and `decision_wait` at which it dies. Tail buffering uses RAM ∝ `traffic × decision_wait`.
2. Add a `memory_limiter` as the **first** processor:
   ```yaml
   processors:
     memory_limiter:
       check_interval: 1s
       limit_mib: 512
       spike_limit_mib: 128
   service:
     pipelines:
       traces:
         processors: [memory_limiter, tail_sampling, batch]
   ```
3. Re-run the load test and observe the collector refusing/dropping new data (back-pressure) instead of crashing. Also tune `num_traces` and a shorter `decision_wait` to lower the ceiling.

**Hints.**
- `memory_limiter` must be first so it sheds before the expensive tail buffer fills.
- Lowering `decision_wait` from 10s to 5s roughly halves buffered traces — at the cost of missing traces slower than the window.
- Back-pressure (dropped/refused spans) is a *graceful* failure; an OOM-killed collector loses everything in flight, including the errors you must keep.

**Acceptance / What you should see.** Pre-limiter: a clear rps at which the collector OOMs. Post-limiter: under the same load it sheds data and stays alive, with `memory_limiter` refusals visible in its own metrics. You can state the relationship `RAM ∝ rps × decision_wait` and name two knobs (`num_traces`, `decision_wait`) that lower the ceiling.

---

## Capstone

This is one open-ended project. The point is not a single correct answer but a complete, defended design — treat it as a proposal you are pitching to a staff engineer and a finance partner at a review.

### Task 12: Design and implement a cost budget + sampling policy for a small fleet

**Goal.** For a small fleet (pick 3–5 services — e.g. an API gateway, a checkout worker, a payments service, a BFF), set per-service series/GB budgets, write the sampling and cost-control policy **as code**, add a spend/cardinality alert, and document the cost-versus-fidelity trade-offs in stakeholder language.

**Scenario to anchor it.** The fleet does ~40k rps at peak, ~25 spans/trace, ~6 metrics families per service, and ships structured JSON logs. The current bill is dominated by 100% tracing and a `customer_id` metric label someone added last quarter. You have a target: cut total telemetry spend by ~50% **without** losing any error, audit, SLO, or billing fidelity.

**Steps.**
1. **Budget.** Write a per-service budget table: max active series per metric and per service, log GB/day, and a trace keep-rate. Example floor: no single metric > 50k series; no service > 200k series; payments logs (audit) retained 400 days at 100%.
2. **Sampling policy as code.** Author the collector config that encodes the fidelity floor explicitly:
   ```yaml
   processors:
     filter/drop-health: { error_mode: ignore, traces: { span: ['IsMatch(name, "^GET /health")'] } }
     attributes/drop-identity:
       actions:
         - { key: customer_id, action: delete }   # off metrics; lives on traces/logs
     tail_sampling:
       decision_wait: 8s
       num_traces: 150000
       policies:
         - { name: errors,     type: status_code, status_code: { status_codes: [ERROR] } }   # 100%
         - { name: audit,      type: string_attribute, string_attribute: { key: audit, values: ["true"] } } # 100%
         - { name: slo-routes, type: string_attribute, string_attribute: { key: http.route, values: ["/checkout","/pay"] } } # 100%
         - { name: slow,       type: latency, latency: { threshold_ms: 2000 } }              # 100%
         - { name: rest,       type: probabilistic, probabilistic: { sampling_percentage: 1 } }
     memory_limiter: { check_interval: 1s, limit_mib: 1024, spike_limit_mib: 256 }
   ```
   Be explicit in comments and prose that **errors, audit, SLO routes, and billing are kept at 100% — never sampled.**
3. **Cardinality control as code.** A Prometheus `metric_relabel_configs` (or collector `attributes`) that enforces the bounded-label rule, plus a recording rule per service to pre-aggregate the dashboard's hot queries.
4. **Spend/cardinality alert.** Wire an alert on `prometheus_tsdb_head_series` per service against its budget, and (if your backend exposes it) an ingestion-GB alert. The alert should page *you* before it pages finance.
   ```yaml
   - alert: ServiceCardinalityBudgetExceeded
     expr: sum by (job) (scrape_series_added) > 200000   # adjust per backend
     for: 10m
     labels: { severity: warning }
     annotations:
       summary: "{{ $labels.job }} exceeded its 200k series budget"
   ```
5. **Trade-off memo.** Write 1–2 pages for stakeholders: what you cut (1% of normal traces, the `customer_id` label, health-check spans, DEBUG in prod, old data downsampled), what you guaranteed (the fidelity floor at 100%), the projected savings, and the residual risk ("we keep 1% of normal traces, so a non-error performance regression on a cold path may take longer to spot — mitigated by exemplars and SLO dashboards"). Cross-reference the Goodhart risk: "reduce telemetry spend" is a metric you can game by deleting fidelity, so the floor is non-negotiable.

**Deliverables.**
- A per-service budget table (series, log GB/day, trace keep-rate).
- A complete, commented collector config (policy-as-code) with the fidelity floor explicit.
- A cardinality-control snippet (relabel/attributes) + at least one recording rule.
- A working spend/cardinality alert with a documented threshold.
- A 1–2 page cost-vs-fidelity memo written for non-engineers.

**Acceptance criteria.**
- [ ] The projected/measured spend drops by roughly your target (~50%) versus the 100%-tracing baseline.
- [ ] Errors, audit, SLO-route, and billing traces are demonstrably kept at **100%** — you can fire synthetic errors and audit events through the pipeline and show every one survived.
- [ ] No metric exceeds its written series budget; the `customer_id` cardinality bomb is gone from metrics and present (cheaply) on traces/logs.
- [ ] The spend/cardinality alert fires when you breach a budget and resolves when you fix it.
- [ ] The memo states the trade-offs and residual risk in language a stakeholder can act on, and names the Goodhart trap. Use the [`observability-stack`](README.md) and [`monitoring-alerting`](README.md) skills to sanity-check your backend topology and alert design.

---

## If you can do all of these, you have the senior level

You can stand up a tail-sampling collector that keeps every error and slow trace from memory, and you can *prove* the fidelity floor held with synthetic traffic rather than hoping it did. You reproduce, diagnose, and kill a cardinality explosion, and you reconstruct true totals from sampled streams — including the mixed-rate Σ of `1/sample_rate` that trips up everyone who reaches for a single multiplier. You design the agent→gateway topology and the `routing_key: traceID` that make tail sampling correct at scale, you keep two services' decisions consistent so traces never come out half-empty, and you've load-tested the collector to its OOM point and put `memory_limiter` in front of it. Most of all, you can write the per-service budget, the policy-as-code, the spend alert, and the stakeholder memo that cut the bill in half without sacrificing a single error, audit, SLO, or billing signal. The next step is not more sampling exercises — it is owning the org's telemetry budget and chargeback model, and defending the fidelity floor when finance asks you to cut deeper.

---

## Related Topics

- [Telemetry Cost & Sampling — Junior](junior.md)
- [Telemetry Cost & Sampling — Middle](middle.md)
- [Telemetry Cost & Sampling — Senior](senior.md)
- [Telemetry Cost & Sampling — Professional](professional.md)
- [Interview prep](interview.md)

**Sibling diagnostic topics:**

- [Metrics](../metrics/) — the cardinality cost driver and the relabel/recording-rule mechanics these tasks reuse.
- [Tracing](../tracing/) — the signal you sample most; spans, `trace_id`, W3C propagation.
- [Logging](../logging/) — the volume cost driver; levels, field pruning, retention tiers.
- [Observability Engineering](../observability-engineering/) — the whole-system strategy this cost discipline serves.
- [Continuous Profiling](../continuous-profiling/) — another signal with its own sampling/cost story.

**Cross-roadmap links:**

- [Quality Engineering → Engineering Metrics & DORA](../../quality-engineering/engineering-metrics-and-dora/) — Goodhart's law: "reduce telemetry cost" is a metric you can game by deleting fidelity. The Capstone memo must name this trap.

---
