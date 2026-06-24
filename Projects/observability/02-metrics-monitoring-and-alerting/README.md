# Metrics, Monitoring & Alerting (SLOs + Error Budgets)

> Instrument a fleet of Go services, then build the monitoring that catches real
> problems and the alerting that does *not* drown the on-call. The deliverable is
> an alert that pages a human only when users are being hurt — driven by SLOs and
> error budgets, not by every CPU spike. Then make the monitoring stack survive
> the cardinality and scrape load it generates while watching a busy fleet.

| | |
|---|---|
| **Tier** | Observability (monitoring) |
| **Primary domain** | Metrics & alerting / SRE |
| **Skills exercised** | Prometheus instrumentation (`client_golang`), counters/gauges/histograms, RED & USE, the four golden signals, cardinality discipline, recording rules, SLI/SLO design, multi-window multi-burn-rate alerting, alert fatigue, TSDB scaling |
| **Interview sections** | 18 (observability), 22 (scalability & HA), 17 (performance) |
| **Est. effort** | 4–6 focused days |

---

## 1. Context

You're on-call for a fleet of ~12 Go services behind an API gateway, doing a
combined ~40k req/s at peak. The current "monitoring" is a wall of 200+ Grafana
panels and 90 alert rules, most of them threshold alerts on host CPU and memory.
Last quarter the team got **paged 312 times**; post-hoc, only **9** of those
pages corresponded to a real user-facing problem. Two genuine outages were
*missed* because the page that would have caught them was buried under
auto-resolving CPU noise nobody reads anymore.

Your job is to rebuild this around **symptom-based, SLO-driven alerting**. You
will instrument the services with metrics that actually describe user experience
(the four golden signals), define SLIs and SLOs for the request-serving path,
and build **multi-window multi-burn-rate** error-budget alerts that page fast on
a real incident and stay quiet otherwise. Then you'll push the monitoring stack
itself until it becomes the bottleneck — high cardinality, high scrape rate,
slow queries — and fix that, because a monitoring system that melts under the
load it observes is worse than useless.

You will produce numbers — alert precision/recall, detection time, scrape and
query cost — not opinions about "good dashboards."

## 2. Goals / Non-goals

**Goals**
- Instrument Go services with the **four golden signals** (latency, traffic,
  errors, saturation) using `client_golang`, choosing the right metric type for
  each and keeping label cardinality bounded.
- Define SLIs and SLOs for at least one request-serving path, and implement
  **multi-window multi-burn-rate** error-budget alerts off them.
- Demonstrate, with an induced incident, that the alert **fires within its target
  detection time** and that low-grade noise does **not** page.
- Build dashboards that answer one question fast: *is it us, or a dependency?*
- Scale the TSDB and scrape path so the monitoring stack holds its own SLOs while
  watching a high-cardinality, high-RPS fleet.

**Non-goals**
- Distributed tracing and log correlation — that's `observability/01` and the
  tracing labs; here metrics are the spine, traces are referenced, not built.
- A managed monitoring SaaS (Datadog/New Relic). Run Prometheus yourself so you
  see scrape, cardinality, and retention as real knobs.
- Building a TSDB from scratch — use Prometheus/Mimir/Thanos/VictoriaMetrics; the
  lab is about *operating* one under load, not implementing the storage engine.

## 3. Functional requirements

1. A **demo fleet** (`cmd/svc`, N instances behind `cmd/gateway`) of Go services
   that each expose `/metrics`, instrumented with the four golden signals:
   request rate, error rate, latency **histogram**, and a saturation signal
   (in-flight requests, queue depth, or pool utilization).
2. A **Prometheus** scrape config that discovers and scrapes the fleet, plus
   **recording rules** that pre-aggregate per-service SLIs.
3. **SLO definitions** (`slo/*.yaml`) for at least one service: an availability
   SLI and a latency SLI, each with a stated objective and window (e.g. 99.9%
   over 30 days).
4. **Alerting rules** implementing multi-window multi-burn-rate error-budget
   alerts (fast-burn page + slow-burn ticket), plus at least one **symptom** vs
   **cause** alert pair demonstrating the difference.
5. An **incident injector** (`cmd/chaos`) that can raise error rate, inject
   latency, and saturate a dependency on demand, so you can measure alert
   detection time and precision.
6. A **cardinality probe** (`cmd/cardinality`) that intentionally explodes label
   cardinality (e.g. user-id or full-URL labels) so you can observe and then cap
   the blast radius.

## 4. Load & data profile

- **Fleet:** ≥ 8 service instances, each exposing **300–1,500 active series**
  under normal labels. Target a Prometheus head holding **≥ 2M active series** at
  the high end (use synthetic exporters to inflate if real services are too
  small).
- **Traffic:** drive the fleet at **≥ 20k req/s** sustained for ≥ 30 minutes per
  run, with a **Zipfian** endpoint/route distribution so a few routes dominate
  and tail latency concentrates.
- **Scrape model:** start at 15 s scrape interval, then push to **1 s** on a
  subset to create scrape pressure; report sample ingestion rate
  (samples/second) and scrape duration per target.
- **Cardinality knobs:** labels under your control — `service`, `route`, `method`,
  `status_class`, `instance`. The probe adds *unbounded* labels (`user_id`,
  raw `path`, `error_message`) to demonstrate the footgun.
- **Retention:** Stage 1 demands ≥ 30 days at full resolution plus a
  downsampled long-retention tier; report bytes/sample and on-disk size.

## 5. Non-functional requirements / SLOs

These SLOs apply to **two systems at once**: the *observed services* and the
*monitoring stack itself*. Both must be measured.

| Metric | Target |
|--------|--------|
| Alerting **precision** (pages that were real) | ≥ 0.8 — at most 1 false page in 5 (vs the baseline's ~0.03) |
| Alerting **recall** (real incidents that paged) | ≥ 0.95 — at most 1 missed real incident in 20 |
| Fast-burn **detection time** (incident start → page) | < 2 min for a hard outage (≈14.4× burn) at 99.9% SLO |
| Slow-burn detection | Ticket (not page) within ~1 h for a low-grade ≈3× burn |
| Alert **flapping** | A single incident produces **one** page, not a storm; resolves cleanly |
| Latency SLI correctness | Computed from a **histogram** (p99/p99.9), never from a pre-averaged mean |
| Scrape health (monitoring stack) | Scrape duration < 0.5 × scrape interval for every target at steady state |
| Query latency (monitoring stack) | Dashboard/alert range queries p99 < 2 s at full cardinality + retention |
| Cardinality blast radius | A single bad label can't take down ingestion: hard per-target series cap enforced |

> The point is **not** a magic precision number — it's to *find* the threshold and
> window where your burn-rate alert catches the real thing fast and stays silent
> on the noise, and to *prove* the monitoring stack stays inside its own SLOs
> while doing it.

## 6. Architecture constraints & guidance

- **Instrumentation:** `prometheus/client_golang`. Latency is a **histogram**
  (native histograms if your stack supports them; otherwise classic buckets sized
  for your SLO thresholds), never a Summary if you need to aggregate quantiles
  across instances — Summary quantiles are per-instance and **cannot be merged**.
- **Metric types, deliberately chosen:** counters for monotonic events
  (requests, errors), gauges for instantaneous state (in-flight, queue depth),
  histograms for distributions you must aggregate (latency, payload size).
  Justify each choice; a gauge for a request count is a bug.
- **Cardinality is a footgun:** never put unbounded values (`user_id`, request
  ID, raw URL, error string) in a label. Bound `route` to the *template*
  (`/users/{id}`), not the concrete path. Total series ≈ ∏(label cardinalities) ×
  instances — do the multiplication *before* you ship.
- **Scrape model:** pull, not push. Recording rules pre-compute expensive SLI
  aggregations so dashboards and alerts query cheap, pre-aggregated series.
- **Alert on symptoms, page on user pain:** alerts that page a human must
  correspond to **SLO burn** (users hurt). Cause-level signals (a saturated pool,
  a hot node) are dashboard/ticket material, not pages, unless they *are* the
  symptom.
- **Scaling the TSDB:** when single-Prometheus head/series limits bite, federate
  or move to a horizontally-scalable backend (Thanos / Mimir / VictoriaMetrics)
  with downsampling for long retention. Recording rules + downsampling are the
  load-bearing levers, not bigger machines.

## 7. Data & metric model

```
# Golden signals per service (RED for request-driven, USE for resources)
http_requests_total{service,route,method,status_class}        counter   # traffic + errors
http_request_duration_seconds_bucket{service,route,le}        histogram # latency
http_inflight_requests{service}                               gauge     # saturation
db_pool_inuse / db_pool_max{service}                          gauge     # USE: utilization
queue_depth{service,queue}                                    gauge     # USE: saturation

# Recording rules — pre-aggregated SLIs (cheap to query)
job:http_requests:rate5m{service}
job:http_request_errors:ratio_rate5m{service}        # errors / total over 5m
job:http_request_duration:p99_5m{service}            # from histogram_quantile

# Error-budget burn = (1 - SLI) / (1 - SLO_objective)
# 99.9% objective → budget = 0.1% of requests; burn=14.4 exhausts 30d budget in ~2h
```

Label cardinality budget (write it down, enforce it): `status_class` ∈
{2xx,3xx,4xx,5xx} (4), `method` (≤7), `route` = bounded template set (≤50),
`service` (≤12), `instance` (≤8). The probe deliberately violates this.

## 8. Interface contract

- `GET /metrics` on every service → Prometheus exposition format.
- `slo/<service>.yaml` → objective, window, SLI queries (PromQL), and the
  generated burn-rate alert rules (a Sloth-style generator is acceptable and
  encouraged — but you must be able to explain the windows it produces).
- `cmd/chaos` flags: `-inject=errors|latency|saturation`, `-magnitude`,
  `-duration`, `-target=<service>` — returns the wall-clock start time so you can
  compute detection time.
- `cmd/cardinality -labels=user_id,path -values=100000` → emits a metric that
  blows up series count; reports resulting head series and ingestion impact.
- Alert payloads route to a local Alertmanager; capture fired/resolved
  timestamps from its API for the precision/recall and detection-time math.

## 9. Key technical challenges

- **Histogram vs summary, and aggregating tails.** Averages lie; you must alert on
  p99/p99.9. Quantiles from Summaries can't be merged across instances —
  histograms can (`histogram_quantile` over summed buckets). Get the bucket
  boundaries near your SLO thresholds or your quantile is garbage.
- **Cardinality discipline.** One careless label (`user_id`) multiplies series by
  millions, blows up TSDB memory, and slows every query. The skill is predicting
  the product *before* shipping and enforcing caps so one bad metric can't take
  the stack down.
- **Burn-rate window design.** A single threshold either pages too slow (long
  window) or flaps on blips (short window). **Multi-window multi-burn-rate**
  (e.g. fast: 1h+5m at 14.4×; slow: 6h+30m at 3×) is the standard answer — and
  the require-both-windows trick is what kills the flapping.
- **Symptom vs cause.** A page must mean "users are hurt." Cause alerts (CPU,
  pool saturation, a single hot node) are how you *diagnose*, not how you *get
  woken up*. Mixing them is the root of alert fatigue.
- **The monitoring melting under what it monitors.** High scrape frequency + high
  cardinality makes Prometheus the thing that falls over. Scrape duration creeps
  past the interval, the head OOMs, queries time out — and you go blind exactly
  when you need to see.

## Stages (0 simple → 1 big data → 2 high RPS → 3 both)

Build Stage 0 correct first — it's the control. Then push the two axes
independently (huge cardinality/retention vs. brutal scrape rate), then both at
once, which is where burn-rate alerting has to fire correctly during a real
incident without flapping.

| Stage | Cardinality / retention | Scrape & query load | What it stresses |
|-------|-------------------------|---------------------|------------------|
| **0 · Simple** | one service, low cardinality | one Prometheus, 15s scrape | correctness: golden-signal board + one good SLO alert that fires right |
| **1 · Big data** | **huge** series count + **long** retention | low scrape rate | TSDB query latency, recording rules, downsampling, compaction |
| **2 · High RPS** | small set, churning | **very high** scrape freq / metric churn | scrape duration, ingestion rate, the monitoring melting under the thing it monitors |
| **3 · Both** | **huge** cardinality **and** high churn | **high** scrape + query load | fleet-wide burn-rate alerting that fires correctly during a real incident without flapping |

- **Stage 0 — Simple.** One service, four golden signals, one Prometheus at 15 s.
  Build a single dashboard (RED) and **one** multi-window burn-rate SLO alert.
  Induce a clean outage; prove the page fires within target and resolves cleanly.
  Everything later is measured against this baseline being *correct*.
- **Stage 1 — Big data.** Inflate to **≥ 2M active series** and **≥ 30 days**
  retention plus a long-retention downsampled tier. Now dashboard range queries
  and alert evaluations get slow. Fix it with **recording rules** (pre-aggregate
  SLIs) and **downsampling** (Thanos/Mimir 5m/1h blocks). Report query p99 before
  and after, and bytes/sample on disk.
- **Stage 2 — High RPS.** Drop scrape interval toward **1 s** on a subset and
  churn metrics hard. Watch scrape duration approach and exceed the interval,
  ingestion rate climb, and the head's memory rise. This is the monitoring stack
  becoming the bottleneck. Fix with scrape-interval tiering, `metric_relabel`
  drops, sample limits, and per-target series caps. Report samples/s sustained
  before scrapes start failing.
- **Stage 3 — Both.** Full fleet, high cardinality **and** high scrape/query
  load, while `cmd/chaos` drives a real incident. The burn-rate alert must page
  fast on the incident, *not* flap as cardinality and query latency fluctuate,
  and the stack must stay inside its own scrape/query SLOs throughout. This is
  "senior/staff done": measured, defended, and survives its own load.

## 10. Experiments to run (break it / tune it)

Record before/after numbers for each.

1. **Histogram vs average.** Drive a bimodal latency distribution. Show the mean
   stays "green" while p99 (from the histogram) is in violation. Quantify how
   long an average-based alert stays blind.
2. **Bucket boundary sensitivity.** Put SLO threshold at 300 ms with buckets at
   {250, 500}ms vs {100, 200, 300, 400, 500}ms. Show `histogram_quantile` error
   shrink as buckets straddle the threshold.
3. **Cardinality explosion.** Run `cmd/cardinality` adding `user_id`. Plot head
   series, RSS, and query latency vs label values added. Then enforce a per-target
   sample limit and show the blast radius capped.
4. **Recording-rule payoff.** Time the raw SLI query vs the recording-rule series
   at 2M series. Report query latency and alert-evaluation duration before/after.
5. **Burn-rate window sweep.** For a fixed 99.9% SLO, compare single 1h-window vs
   multi-window (1h+5m / 6h+30m). Induce (a) a hard outage and (b) a brief blip.
   Measure detection time on the outage and false-page count on the blip.
6. **Symptom vs cause page test.** Inject dependency saturation that does *not*
   yet breach the SLO. Show the cause alert lights the dashboard but the SLO page
   stays silent; then escalate until the symptom alert correctly pages.
7. **Scrape meltdown.** Push scrape interval to 1 s across the fleet. Find where
   scrape duration exceeds the interval and ingestion backs up. Report the
   samples/s ceiling and the fix that recovers it.
8. **Incident under load (Stage 3).** During a 30-min full-load run, fire a real
   error-rate incident. Prove: page within detection target, **exactly one**
   page, clean resolve, and the monitoring stack's own scrape/query SLOs held.
   Compute precision and recall over the whole run.

## 11. Milestones

1. Demo fleet + gateway up; four golden signals instrumented; one Prometheus
   scraping; a RED dashboard.
2. SLI/SLO defined; first multi-window burn-rate alert; clean induced outage
   pages correctly (Stage 0 done).
3. Inflate to 2M series + 30d retention; recording rules + downsampling; query
   latency fixed (Stage 1, experiments 1–4).
4. Push scrape to 1 s; observe and fix the scrape meltdown; cardinality caps
   (Stage 2, experiments 3, 7).
5. Full-load Stage 3 incident run; precision/recall + detection-time numbers;
   findings note (experiments 5, 6, 8).

## 12. Acceptance criteria (definition of done)

- [ ] Every golden signal instrumented with the **correct metric type**, choices
      justified; latency is a histogram with SLO-aligned buckets.
- [ ] At least one SLO with a multi-window multi-burn-rate alert, generated rules
      readable and explained (not a black-box generator).
- [ ] Induced hard outage **pages within the detection target** and produces
      **exactly one** page that resolves cleanly — Alertmanager timestamps shown.
- [ ] A brief blip produces **zero** pages — flapping eliminated, shown by run.
- [ ] Precision ≥ 0.8 and recall ≥ 0.95 computed over a Stage-3 run, with the
      fired/real incident ledger attached.
- [ ] Cardinality explosion demonstrated **and** capped; head series and query
      latency before/after shown.
- [ ] At ≥ 2M series + 30d retention, dashboard/alert query p99 < 2 s after
      recording rules + downsampling; before/after numbers shown.
- [ ] At full scrape load, scrape duration < 0.5 × interval for every target;
      the meltdown-and-recovery is documented with samples/s numbers.
- [ ] Every number reproducible from a committed command + config.

## 13. Stretch goals

- **Native histograms** (sparse) vs classic buckets: compare series count,
  ingestion cost, and quantile accuracy at the same cardinality.
- **Exemplars**: link a latency-bucket spike to a trace ID and jump from the
  dashboard to the slow request (pairs with the tracing lab).
- **Adaptive scrape / streaming**: move the hottest targets to push (remote-write)
  or agent mode and compare cost.
- **Meta-monitoring**: alert on the monitoring stack's *own* SLOs (scrape success
  ratio, rule-evaluation latency) — who watches the watcher.
- **SLO-as-code pipeline**: generate alerts from `slo/*.yaml` in CI and fail the
  build on an un-budgeted, page-level threshold alert (anti-fatigue gate).

## 14. Evaluation rubric

| Dimension | Senior bar | Staff bar |
|-----------|-----------|-----------|
| Instrumentation | Right metric types; golden signals present | Histogram buckets tuned to SLOs; explains why Summary can't aggregate |
| Cardinality | Knows labels cause series | Predicts the product before shipping; enforces caps so one bad label can't take the stack down |
| SLO design | Defines an SLI/SLO | Ties alerting to **error budget**; chooses windows with detection-time math |
| Alert quality | Symptom-based alerts that fire | **Kills alert fatigue**: multi-window multi-burn-rate, dedup/group/silence, precision ≥ 0.8 with evidence |
| Detection | Alert eventually fires | Fast-burn pages in target time, slow-burn tickets, no flapping — proven under load |
| Monitoring at scale | Stands up Prometheus | Keeps the stack inside its **own** SLOs at 2M series + 1 s scrape; recording rules + downsampling with numbers |
| Communication | Clear dashboards + findings note | Could defend every burn-rate window and the precision/recall ledger to a staff panel |

> Staff bar in one line: alerting is **SLO/error-budget-driven and kills alert
> fatigue** — a page means users are hurt, fires fast, never flaps, and the
> monitoring stack survives the load it watches.

## 15. References

- Google SRE Book — Ch. 4 (SLOs), Ch. 6 (Monitoring), and the SRE Workbook
  chapter on **Alerting on SLOs** (multi-window multi-burn-rate).
- The four golden signals (SRE Book) · **RED** method (Tom Wilkie) · **USE**
  method (Brendan Gregg).
- Prometheus docs: instrumentation best practices, histograms vs summaries,
  recording & alerting rules, cardinality, native histograms.
- `prometheus/client_golang` instrumentation examples.
- Thanos / Mimir / VictoriaMetrics docs on downsampling and long-term storage.
- See also: `Interview Question/18-observability/` and
  `Interview Question/22-scalability-and-high-availability/`.
- Pairs with `observability/01-centralized-logging-pipeline/` (logs spine) and
  `senior/06-observability-backend/` (high-cardinality ingest internals).
