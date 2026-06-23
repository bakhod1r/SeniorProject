# `runtime/metrics` — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Design Decision: Why a New Package At All](#the-design-decision-why-a-new-package-at-all)
3. [Exporting to Prometheus the Right Way](#exporting-to-prometheus-the-right-way)
4. [Sampling Cadence and Cost](#sampling-cadence-and-cost)
5. [Histogram Export and the Boundary Problem](#histogram-export-and-the-boundary-problem)
6. [Cardinality and What Not to Export](#cardinality-and-what-not-to-export)
7. [Version Skew Across the Fleet](#version-skew-across-the-fleet)
8. [Stable vs Unstable Metrics in Production](#stable-vs-unstable-metrics-in-production)
9. [Using Metrics to Diagnose Real Incidents](#using-metrics-to-diagnose-real-incidents)
10. [The Relationship to GOMEMLIMIT and GC Tuning](#the-relationship-to-gomemlimit-and-gc-tuning)
11. [Metrics vs Profiling vs Tracing](#metrics-vs-profiling-vs-tracing)
12. [Anti-Patterns](#anti-patterns)
13. [Senior-Level Checklist](#senior-level-checklist)
14. [Summary](#summary)

---

## Introduction

A senior engineer's relationship with `runtime/metrics` is not "how do I call `Read`" but "what do I export, at what cost, and what does each number tell me when the pager goes off at 3 a.m." The mechanical API is in [junior.md](junior.md) and [middle.md](middle.md). This file is about the design rationale and the operational decisions: which metrics earn a place on a dashboard, how to convert them to Prometheus types correctly, what sampling costs, how to survive a fleet running mixed Go versions, and how to read these numbers during an incident.

After reading this you will:
- Justify why the package exists and what it fixed about `MemStats`
- Export runtime metrics to Prometheus with correct counter/gauge/histogram semantics
- Reason about sampling cadence, cost, and cardinality at scale
- Handle Go version skew without breaking dashboards
- Use specific metrics to diagnose GC pressure, scheduler starvation, and leaks
- Avoid the anti-patterns that turn cheap observability into a liability

---

## The Design Decision: Why a New Package At All

`runtime.MemStats` had three structural problems, and `runtime/metrics` is the deliberate answer to all three.

### Problem 1 — The struct is frozen

`MemStats` is part of the Go 1 compatibility promise. Fields cannot be removed, renamed, or meaningfully repurposed. So as the runtime evolved — generational-ish GC behaviour, the page allocator rewrite, `GOMEMLIMIT` — new internal state had no place to surface. Some fields became misleading (`EnableGC`, `DebugGC`), some semantics drifted. A frozen struct cannot grow.

`runtime/metrics` solves this with *runtime discovery*. The set of metrics is data, not a struct definition, so the runtime team can add metrics in any release without breaking the compatibility promise. `metrics.All()` is the version-specific catalogue.

### Problem 2 — Reading stops the world

`ReadMemStats` halts every goroutine to copy a consistent snapshot. On latency-sensitive services, periodic `MemStats` reads inject pauses — you degrade the very thing you measure. `runtime/metrics` is built to read from per-P counters and atomics without a global stop-the-world, making continuous sampling viable.

### Problem 3 — No distributions

`MemStats` exposes a 256-element ring of recent GC pauses and little else distributional. You could not get scheduler latency, mutex wait time, or a real pause-time histogram. `runtime/metrics` adds `KindFloat64Histogram` and families like `/sched/latencies:seconds` and `/cpu/*` that simply did not exist before.

The senior framing: `runtime/metrics` is the runtime team buying themselves *room to evolve* while giving operators *cheaper, richer* signals. It is not cosmetic; it changes what you can observe and how often.

---

## Exporting to Prometheus the Right Way

The standard `prometheus/client_golang` ships a collector built on `runtime/metrics`. You almost never hand-roll this — but you must understand what it does, because correctness lives in the details.

### Use the built-in collector

```go
import "github.com/prometheus/client_golang/prometheus/collectors"

reg := prometheus.NewRegistry()
reg.MustRegister(collectors.NewGoCollector(
    collectors.WithGoCollectorRuntimeMetrics(
        collectors.MetricsAll, // or a curated rule set
    ),
))
```

`NewGoCollector` reads `runtime/metrics`, maps each metric to the correct Prometheus type, and translates names (`/gc/heap/allocs:bytes` → `go_gc_heap_allocs_bytes_total`). It knows which metrics are cumulative (export as `Counter`), which are instantaneous (`Gauge`), and which are histograms (`Histogram`). Reinventing this is how people ship wrong dashboards.

### The mapping rules the collector applies

- **Cumulative scalar** → Prometheus `Counter`, name suffixed `_total`.
- **Instantaneous scalar** → Prometheus `Gauge`.
- **Cumulative histogram** → Prometheus `Histogram` with native or classic buckets derived from the metric's `Buckets`.
- **Unit normalisation** — `:seconds` stays seconds (Prometheus convention), `:bytes` stays bytes.

### Curate, do not dump

`MetricsAll` exports everything. In a large fleet that is dozens of series per process, many of which nobody graphs. Prefer a curated rule set:

```go
collectors.WithGoCollectorRuntimeMetrics(
    collectors.GoRuntimeMetricsRule{Matcher: regexp.MustCompile(`^/sched/latencies:seconds$`)},
    collectors.GoRuntimeMetricsRule{Matcher: regexp.MustCompile(`^/gc/.*`)},
)
```

Export what you alert on and dashboard; drop the rest. Every exported series costs scrape bandwidth, TSDB storage, and query time across every instance.

---

## Sampling Cadence and Cost

`metrics.Read` is cheap but not free, and its cost is dominated by two factors: how many samples you pass, and whether any are histograms (which copy slices).

### Cadence

- **Dashboards and alerts:** sample at the scrape interval (typically 15–60s). The Prometheus collector reads on scrape, which is exactly right.
- **High-resolution debugging:** a few times per second is the practical floor; beyond that you measure noise and add overhead.
- **Never** sample in a request hot path. Runtime metrics are process-global; per-request sampling buys nothing and costs allocations.

### Cost model

- Scalar reads are O(number of samples), each a cheap counter aggregation.
- Histogram reads copy `Counts` and `Buckets`; that allocation is the priciest part. Read histograms only as often as you export them.
- The Prometheus collector reads on demand at scrape time, so cost is bounded by scrape frequency × exported metric count.

The senior rule: **bound the work to the scrape**. One read per scrape, only the metrics you publish, slice reuse for any custom collector. That keeps observability overhead in the noise even on a thousand-instance fleet.

---

## Histogram Export and the Boundary Problem

Histograms are where naive export goes wrong.

### The runtime's buckets are not your SLO buckets

`/gc/pauses:seconds` and `/sched/latencies:seconds` come with bucket boundaries chosen by the runtime — exponentially spaced, with infinite outer edges. They are not the round-number buckets (`0.005, 0.01, 0.025, ...`) you might pick for an SLO. The Prometheus Go collector preserves the runtime's boundaries (mapping to native histograms where available). Do not try to re-bucket into your own boundaries by reading the histogram and re-counting — you lose precision and fight the design.

### Infinite edges

The first and last `Buckets` entries may be `±Inf`. Prometheus classic histograms cap at `+Inf` naturally; for the negative or zero-floor edge, the collector handles the translation. If you export by hand, you must clamp infinities to representable bounds, which is one more reason to use the library.

### Cumulative subtraction is the query layer's job

Runtime histograms are cumulative. You export the cumulative buckets; PromQL's `rate()`/`histogram_quantile()` does the windowed differencing and quantile interpolation. Do not pre-difference in your collector — you would duplicate, and likely contradict, what the query engine does correctly.

---

## Cardinality and What Not to Export

`runtime/metrics` has no labels — each metric is a single global series per process. That is *good* for cardinality: there is no per-request explosion. The cardinality risk comes entirely from **how many distinct metrics you export multiplied by your instance count**.

Guidelines:

- **A few dozen series per process is fine; a few hundred adds up.** Multiply by instance count: 100 metrics × 2,000 instances = 200,000 active series for runtime data alone.
- **Histograms multiply.** Each histogram becomes many bucket series. Two histograms can be more series than twenty scalars.
- **Drop what you never query.** If `/memory/classes/profiling/buckets:bytes` is on no dashboard and no alert, do not export it.
- **Do not add labels to runtime metrics.** Resist relabelling a global runtime metric with per-tenant labels; that fabricates cardinality the runtime never intended and is almost always wrong.

The discipline is *curation*: pick the 10–20 metrics that map to your SLOs and capacity model, and export only those. The full set belongs in an ad-hoc debug endpoint, not in your steady-state scrape.

---

## Version Skew Across the Fleet

A real fleet runs more than one Go version at a time — staged rollouts, canaries, lagging services. The metric set differs across versions, and your observability must not assume uniformity.

### What changes across versions

- New metrics appear (`/cpu/*` in 1.20, `/gc/gogc:percent`, `/sched/gomaxprocs:threads`, `/godebug/*` in 1.21).
- Some metrics are documented unstable and can change name or semantics.
- Histogram bucket boundaries for a given metric can change between Go versions.

### Surviving it

- **The collector adapts per-process.** Because each process discovers via `All()`, a 1.19 instance simply does not emit `/cpu/*`. Your dashboards must tolerate a series being absent on some instances (use `or` / `clamp` in PromQL, not assertions).
- **Do not diff histograms across versions.** Windowed subtraction is valid within one process; never persist buckets from a 1.20 instance and subtract a 1.21 instance's buckets.
- **Pin a baseline metric set** that exists on your *oldest* supported Go version for alerts; treat newer metrics as enrichment that may be missing during a rollout.

The senior takeaway: design dashboards and alerts to degrade gracefully when a metric is absent, because during every Go upgrade, for a while, it will be.

---

## Stable vs Unstable Metrics in Production

The package documents some metrics as stable and others as potentially changing. The distinction matters for what you build durable alerts on.

- **Stable metrics** — the `/gc/*`, `/memory/classes/*`, `/sched/goroutines`, `/sched/latencies` core. Safe foundations for alerting; their names and semantics are committed to.
- **Unstable / evolving metrics** — newer or experimental ones may be renamed or have their meaning refined. Fine for dashboards and exploration; risky as the sole trigger for a paging alert, because a Go upgrade could silently drop the series.

Build *page-worthy* alerts on the stable subset. Use the rest for context panels and investigation. When you do depend on a newer metric for an alert, document the minimum Go version and gate the rollout accordingly.

---

## Using Metrics to Diagnose Real Incidents

The payoff of understanding the catalogue is fast diagnosis. A few worked signatures:

### "Latency spiked but CPU looks normal"

Check `/sched/latencies:seconds`. A right-shifted scheduling-latency histogram means goroutines are runnable but waiting for a P — you are under-provisioned on `GOMAXPROCS` or starving the scheduler with too many runnable goroutines. Cross-check `/sched/goroutines:goroutines` for a goroutine explosion.

### "Memory keeps climbing"

Read the whole `/memory/classes/*` family. If `heap/objects` grows unbounded, it is a live-set leak (real references retained). If `heap/released` is low while `heap/free` is high, the scavenger is not returning memory — check `GOMEMLIMIT` and scavenge CPU (`/cpu/classes/scavenge/total:cpu-seconds`).

### "GC is eating the box"

`/cpu/classes/gc/total:cpu-seconds` as a fraction of `/cpu/classes/total:cpu-seconds` tells you the GC CPU tax directly. A high fraction with frequent `/gc/cycles/total:gc-cycles` increments means allocation pressure — either tune `GOGC`/`GOMEMLIMIT` or cut allocation rate (`/gc/heap/allocs:bytes` rate).

### "Tail latency from GC pauses"

`/gc/pauses:seconds` is the distribution. A long tail there correlates directly with request-latency tails. This is the histogram `MemStats` could only approximate.

### "Mutex contention suspected"

`/sync/mutex/wait/total:seconds` rate gives a cheap, always-on contention signal before you reach for the mutex profiler. A rising rate justifies a `pprof` mutex profile.

The pattern: metrics narrow the hypothesis cheaply and continuously; profiling and tracing confirm it expensively and on demand.

---

## The Relationship to GOMEMLIMIT and GC Tuning

`runtime/metrics` is the read side; GC tuning is the write side. They are designed to work together (see [05-godebug-and-runtime-debug](../05-godebug-and-runtime-debug/senior.md)).

- `/gc/gomemlimit:bytes` and `/gc/gogc:percent` (Go 1.21+) report the *active* `GOMEMLIMIT` and `GOGC`. Export them so a dashboard shows the tuning a process is actually running under — invaluable when configs drift.
- `/gc/heap/goal:bytes` shows the heap size the GC currently targets; comparing it to `heap/objects:bytes` tells you headroom before the next cycle.
- After setting `GOMEMLIMIT`, watch `/cpu/classes/gc/total:cpu-seconds` and `/cpu/classes/scavenge/total:cpu-seconds`: a too-tight limit shows up as the runtime burning CPU fighting to stay under it (a "GC death spiral" signature).

Tuning blind is guessing; tuning with these metrics in front of you is engineering.

---

## Metrics vs Profiling vs Tracing

`runtime/metrics` is one of three runtime-introspection tools, and choosing the right one matters.

| Tool | Cost | Granularity | When |
|------|------|-------------|------|
| `runtime/metrics` | very low, always-on | aggregate, process-global | continuous dashboards, alerts, capacity |
| `pprof` profiling | moderate, on-demand | per-function, per-call-site | "which code allocates / blocks / burns CPU" |
| execution tracing | high, short windows | per-event, per-goroutine | "what exactly happened in these 2 seconds" |

The senior workflow is layered: metrics watch continuously and trigger an alert; that alert narrows the hypothesis (GC? scheduler? leak?); then you reach for the matching profiler or a trace to confirm. Metrics are the cheap, always-on layer that tells you *where to point* the expensive tools.

---

## Anti-Patterns

- **Hand-rolling the Prometheus mapping** instead of using `collectors.NewGoCollector`. You will get counter-vs-gauge or histogram boundaries wrong.
- **Exporting `MetricsAll` on a large fleet.** Series count × instance count balloons your TSDB. Curate.
- **Sampling in the request path.** Process-global metrics gain nothing from per-request reads and cost allocations.
- **Re-bucketing runtime histograms** into your own boundaries in the collector. You lose precision and fight the design; export native buckets and quantile in PromQL.
- **Pre-differencing cumulative metrics in code.** Let `rate()` do it; doing both double-counts.
- **Alerting on unstable metrics** that can vanish on a Go upgrade.
- **Asserting a metric exists** across the fleet. During rollouts, version skew means some instances lack newer metrics; dashboards must tolerate absence.
- **Keeping a `MemStats` periodic read "for safety"** alongside metrics — you reintroduce the stop-the-world you migrated away from.
- **Adding per-tenant labels** to global runtime metrics, fabricating cardinality.
- **Comparing `/memory/classes/total:bytes` to RSS** and treating a gap as a bug; they account different things.

---

## Senior-Level Checklist

- [ ] Use `collectors.NewGoCollector` rather than hand-mapping to Prometheus
- [ ] Curate the exported metric set to what you alert on and dashboard
- [ ] Bound sampling to the scrape interval; never sample per request
- [ ] Export native histogram buckets; quantile in the query layer
- [ ] Build paging alerts on the stable metric subset only
- [ ] Make dashboards tolerate absent metrics during Go version rollouts
- [ ] Never diff histogram buckets across Go versions
- [ ] Export `/gc/gomemlimit:bytes` and `/gc/gogc:percent` for config visibility
- [ ] Use `/sched/latencies`, `/memory/classes/*`, `/cpu/classes/*` as first-line incident signals
- [ ] Treat metrics as the cheap layer that points profiling/tracing at the problem
- [ ] Drop any `ReadMemStats` periodic polling once migrated

---

## Summary

`runtime/metrics` exists to fix three structural limits of `MemStats`: a frozen struct that could not grow, a stop-the-world read that degraded the systems it measured, and the absence of distributions. The senior responsibility is turning that capability into reliable, affordable observability.

That means exporting through the standard `NewGoCollector` so counter/gauge/histogram semantics are correct; curating the exported set so cardinality stays bounded across a large fleet; bounding sampling to the scrape; preserving native histogram buckets and quantiling in PromQL; and designing dashboards and alerts that degrade gracefully under Go version skew. It also means knowing the catalogue well enough to read it during an incident — `/sched/latencies` for scheduling pressure, `/memory/classes/*` for leaks, `/cpu/classes/gc` for GC tax, `/gc/pauses` for latency tails — and treating metrics as the cheap, always-on layer that aims the expensive profiling and tracing tools.

The API is trivial. The judgement — what to export, at what cost, and what each number means when something is on fire — is the senior work.
