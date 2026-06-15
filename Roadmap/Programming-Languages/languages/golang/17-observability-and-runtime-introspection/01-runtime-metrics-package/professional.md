# `runtime/metrics` — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [How `Read` Works Internally](#how-read-works-internally)
3. [The `Value` Type as a Tagged Union](#the-value-type-as-a-tagged-union)
4. [Histogram Internals and Bucket Construction](#histogram-internals-and-bucket-construction)
5. [Where the Numbers Come From](#where-the-numbers-come-from)
6. [The Naming and Stability Contract](#the-naming-and-stability-contract)
7. [Designing a Production-Grade Collector](#designing-a-production-grade-collector)
8. [The Prometheus Mapping in Detail](#the-prometheus-mapping-in-detail)
9. [Cost, Allocation, and Snapshot Consistency](#cost-allocation-and-snapshot-consistency)
10. [Edge Cases the Source Reveals](#edge-cases-the-source-reveals)
11. [Programmatic Patterns](#programmatic-patterns)
12. [Operational Playbook](#operational-playbook)
13. [Summary](#summary)

---

## Introduction

The professional level treats `runtime/metrics` not as a convenience API but as a contract between the runtime's internal statistics machinery and every collector that consumes it. The package writes values into your `Value` storage under specific consistency and allocation rules; misunderstanding those rules is the source of subtle collector bugs — retained histograms that mutate, snapshots that are not as atomic as you assumed, and exporters that get counter-vs-gauge wrong.

This file is for engineers who maintain observability infrastructure, write custom collectors, integrate runtime metrics into OTel or Prometheus pipelines, or own the correctness of a fleet's runtime telemetry. After reading you will:

- Know what `metrics.Read` does internally and what consistency it guarantees.
- Reason about `Value` as a tagged union with inline scalar storage and shared histogram backing.
- Understand how the runtime constructs histogram buckets and where the numbers originate.
- Implement a production collector that is allocation-stable and version-robust.
- Know the precise rules the Prometheus collector applies, so you can replicate or extend them.

The package is small. Its correctness, like vendoring's, lives in consistency machinery rather than in the surface API.

---

## How `Read` Works Internally

`metrics.Read` lives in `runtime/metrics` and bridges into the runtime's statistics aggregation (`runtime/metrics.go` and the `metrics` description table in the runtime package). Stripped to essentials, the flow per call is:

1. **Resolve each requested name** against the runtime's static metric table. The table is generated from the set of metrics the runtime supports in this build.
2. **For known names,** invoke the metric's *compute function* — a runtime-internal routine that fills the `Value` from current statistics.
3. **For unknown names,** set `Value` to `KindBad`.
4. **Batch the snapshot.** The runtime gathers a coherent set of values; several metrics derived from the same underlying state are computed together so they are mutually consistent.

```go
// Conceptual shape, not the literal source.
func Read(m []Sample) {
    for i := range m {
        d, ok := lookup(m[i].Name)
        if !ok {
            m[i].Value = badValue()
            continue
        }
        d.compute(&m[i].Value) // fills inline scalar or shared histogram slices
    }
}
```

The key professional fact: `Read` does **not** spin up a stop-the-world for the common path. Most metrics are backed by per-P (`mstats`, `memstats`, scheduler) counters aggregated with atomics. The runtime is engineered so that a coherent read of related metrics does not require halting goroutines, in deliberate contrast to `ReadMemStats`.

---

## The `Value` Type as a Tagged Union

`Value` is an opaque struct carrying a kind tag and storage:

```go
type Value struct {
    kind    ValueKind
    scalar  uint64        // holds Uint64 directly; Float64 via math.Float64frombits
    pointer unsafe.Pointer // points at a *Float64Histogram when kind is histogram
}
```

(The exact field layout is unexported; this is the model.)

Consequences that matter to a collector author:

- **Scalars are inline.** `Uint64()` returns `scalar`; `Float64()` returns `math.Float64frombits(scalar)`. Copying a scalar `Value` is a value copy — safe to retain.
- **Histograms are by reference.** `Float64Histogram()` returns a pointer into storage that `Read` *may reuse* on the next call. Retaining the returned `*Float64Histogram` and reading again can mutate your retained copy. To keep a histogram, deep-copy `Counts` and `Buckets`.
- **The wrong accessor panics.** `Float64()` on a histogram value, or `Uint64()` on a float, is a hard panic by design — there is no error return. The accessor is the type assertion of this union.

`ValueKind` is a small enum: `KindBad`, `KindUint64`, `KindFloat64`, `KindFloat64Histogram`. `KindBad` is reserved for "metric not present"; it never appears in `Description.Kind` for a real metric.

---

## Histogram Internals and Bucket Construction

```go
type Float64Histogram struct {
    Counts  []uint64  // len N
    Buckets []float64 // len N+1, sorted ascending
}
```

The runtime maintains these histograms as time-weighted or count-weighted internal structures (e.g. GC pause durations are recorded into a fixed bucket layout as cycles complete). When you `Read`:

- **`Buckets` is the boundary array,** strictly increasing, with `Buckets[i]` the inclusive lower edge and `Buckets[i+1]` the exclusive upper edge of bucket `i`.
- **Outer edges may be infinite.** `Buckets[0]` is frequently `math.Inf(-1)` (or `0` for non-negative quantities) and `Buckets[N]` is frequently `math.Inf(1)`. This makes the first and last buckets open-ended catch-alls.
- **Bucket layout is exponential.** The runtime uses sub-power-of-two spacing so that both microsecond pauses and multi-millisecond pauses land in meaningful buckets. The exact layout is an implementation detail and *can change between Go versions* — never hard-code boundaries.
- **Counts are cumulative for cumulative metrics.** For `Description.Cumulative == true`, `Counts` are lifetime totals; windowed distributions require element-wise subtraction of two snapshots taken within the same process and Go version.

A correct consumer treats `Buckets` as opaque, version-specific boundaries: it copies them, optionally subtracts a prior snapshot bucket-by-bucket, and hands the result to a histogram-aware sink. It does not re-bin into different boundaries (that loses information) and does not assume the layout matches any other metric or version.

---

## Where the Numbers Come From

Understanding provenance prevents misinterpretation:

- **`/gc/*`** derive from `mstats`/`gcController` state updated as GC cycles run. `/gc/heap/allocs:bytes` is the running allocation total maintained by the allocator; `/gc/pauses:seconds` is recorded at each stop-the-world mark/termination phase.
- **`/memory/classes/*`** come from the page allocator and `mstats` memory accounting. They partition the runtime's *mapped* virtual memory into disjoint classes, summing to `/memory/classes/total:bytes`. This is the runtime's view, not the OS RSS.
- **`/sched/goroutines:goroutines`** is the live goroutine count from the scheduler. `/sched/latencies:seconds` is recorded when a goroutine transitions from runnable to running, capturing scheduler queueing delay.
- **`/cpu/classes/*`** (1.20+) come from the runtime's CPU-time accounting, attributing CPU-seconds to GC, scavenge, user, and idle. These are *runtime-attributed* CPU seconds, not `getrusage` — they reflect how the Go runtime categorises the CPU it used.
- **`/sync/mutex/wait/total:seconds`** accumulates blocked time from the `sync.Mutex`/`RWMutex` slow path.

Because these are sourced from live runtime state, a value of zero often means "this has not happened yet" (no GC, no contention) rather than an error.

---

## The Naming and Stability Contract

The naming format is specified, not incidental:

```
name := path ":" unit
path := "/" segment { "/" segment }
unit := ident { ("-"|"*"|"/") ident }
```

- The **path** is a hierarchical, slash-separated identifier. It is unique per metric.
- The **unit** disambiguates: `bytes`, `seconds`, `objects`, `goroutines`, `gc-cycles`, `cpu-seconds`, `percent`, `threads`. Two metrics with the same path but different units are *different metrics*.
- Units compose: `cpu-seconds` is CPU-seconds; a hypothetical `bytes/second` would be a rate. The unit is part of the name string, colon included.

The stability contract:

- Metrics are documented as **stable** or subject to change. Stable metric names and semantics are committed to across releases.
- The full set is **versioned**: a binary exposes exactly the metrics its Go version supports, discoverable via `All()`.
- Unknown names read as `KindBad`, never an error — the forward-compatibility mechanism.

A professional collector treats the metric table as version data: discover at startup, map the present subset, and tolerate both new (ignored) and absent (`KindBad`) names.

---

## Designing a Production-Grade Collector

A robust collector separates discovery, mapping, and reading, and is allocation-stable on the hot path.

```go
type metricSpec struct {
    name       string
    kind       metrics.ValueKind
    cumulative bool
}

type RuntimeCollector struct {
    specs   []metricSpec
    samples []metrics.Sample // allocated once, reused
}

func NewRuntimeCollector(want []string) *RuntimeCollector {
    table := map[string]metrics.Description{}
    for _, d := range metrics.All() {
        table[d.Name] = d
    }
    rc := &RuntimeCollector{}
    for _, n := range want {
        d, ok := table[n]
        if !ok {
            continue // not on this Go version; skip cleanly
        }
        rc.specs = append(rc.specs, metricSpec{n, d.Kind, d.Cumulative})
        rc.samples = append(rc.samples, metrics.Sample{Name: n})
    }
    return rc
}

func (rc *RuntimeCollector) Collect(emit func(spec metricSpec, v metrics.Value)) {
    metrics.Read(rc.samples) // reuses storage; zero steady-state allocation for scalars
    for i := range rc.samples {
        emit(rc.specs[i], rc.samples[i].Value)
    }
}
```

Design properties:

- **Discovery once.** `All()` is consulted at construction; the hot path never touches it.
- **No `KindBad` on the hot path.** Unsupported names are dropped at construction, so `Read` only ever sees known names.
- **Slice reuse.** `samples` is allocated once. Scalar reads allocate nothing; only histogram consumers allocate, and only when they copy.
- **Kind and cumulative captured at build time,** so the emit step does not re-derive them.

This is the shape underneath `NewGoCollector`; replicate it only when you need behaviour the standard collector does not offer (custom sinks, OTel-native histograms, selective export with bespoke naming).

---

## The Prometheus Mapping in Detail

The `prometheus/client_golang` `GoCollector` applies deterministic rules. Knowing them lets you reproduce or audit the mapping.

### Name translation

- Leading `/` dropped, internal `/` → `_`, `:` → `_`.
- `/gc/heap/allocs:bytes` → `go_gc_heap_allocs_bytes`; cumulative metrics gain a `_total` suffix per Prometheus convention → `go_gc_heap_allocs_bytes_total`.

### Type selection

- `Cumulative` scalar → `Counter`.
- Non-cumulative scalar → `Gauge`.
- Cumulative `Float64Histogram` → `Histogram`, with buckets derived from the metric's `Buckets`. Modern client versions can emit native (sparse) histograms, preserving the runtime's exponential layout faithfully.

### Bucket handling

- Infinite outer edges are translated to Prometheus's `+Inf` bucket and a finite lower bound.
- The runtime's boundaries are preserved rather than re-bucketed, so `histogram_quantile` interpolates over the runtime's actual resolution.

### Unit conventions

- `:seconds` is kept in seconds (Prometheus base unit); `:bytes` kept in bytes. No silent unit conversion.

When you extend the collector (custom rule sets via `WithGoCollectorRuntimeMetrics`), you supply matchers against the *raw* `runtime/metrics` names, and the mapping rules above apply to whatever passes the matcher.

---

## Cost, Allocation, and Snapshot Consistency

### Cost

`Read` cost is roughly linear in the number of samples, plus the per-metric compute cost. Scalars are cheap atomic reads; histograms copy their slices into your `Value` storage, which is the dominant allocation. The Prometheus collector reads on scrape, bounding total cost to `scrape_freq × exported_metrics`.

### Allocation profile

- Reusing one `[]Sample` makes scalar reads steady-state allocation-free.
- Each histogram `Read` writes into slice storage associated with the `Value`; if the collector retains a histogram it must copy, which allocates.
- A common mistake is allocating the `[]Sample` per scrape — measurable garbage on a high-scrape fleet.

### Snapshot consistency

`Read` provides a *coherent* read of the metrics passed in a single call — related quantities (e.g. allocs and frees) are gathered consistently. It does **not** guarantee a globally frozen instant the way a stop-the-world snapshot would; the runtime continues executing. For almost all observability this coherence is sufficient. If you require two metrics to be mutually exact to the byte, read them in the *same* `Read` call rather than two calls.

---

## Edge Cases the Source Reveals

A close reading of the metric table and `Read` implementation exposes corners most users never hit:

- **A histogram with all-zero `Counts`** is valid early in process life (no events yet). Iterate and find nothing; not an error.
- **`Description.Kind` is never `KindBad`** — that kind only originates from `Read` on an unknown name. Code that switches on `Description.Kind` need not handle `KindBad`.
- **Bucket boundaries can include `0` rather than `-Inf`** for non-negative quantities; do not assume the first edge is always `-Inf`.
- **Retained histograms alias `Read` storage.** Two consecutive `Read` calls into the same `[]Sample` will overwrite the previous histogram's backing arrays. Copy before re-reading.
- **`/memory/classes/total:bytes` is the sum of classes by construction** — if your re-summed classes disagree, you missed a class (e.g. a metadata sub-leaf) or read across two non-atomic calls.
- **New metrics in a newer runtime** appear in `All()` automatically; a collector that hard-codes a name list will silently miss them until updated. Discovery-driven collectors do not.
- **Unstable metrics may change `Kind`** across versions in principle; capturing `Kind` per-process from `All()` (not hard-coding it) keeps the accessor correct.

These are pointers to *reach for the docs and source* (`runtime/metrics` package docs, `src/runtime/metrics.go`, and the description table) when something surprises you. The implementation is tractable in an afternoon.

---

## Programmatic Patterns

### Dump every metric (debug endpoint)

```go
descs := metrics.All()
samples := make([]metrics.Sample, len(descs))
for i, d := range descs {
    samples[i].Name = d.Name
}
metrics.Read(samples)
// format each by Kind into JSON for an internal /debug/metrics handler
```

Acceptable for an on-demand debug handler; not for steady-state scrape (read only what you export).

### Windowed histogram delta

```go
func deltaHistogram(prev, cur *metrics.Float64Histogram) []uint64 {
    out := make([]uint64, len(cur.Counts))
    for i := range cur.Counts {
        out[i] = cur.Counts[i] - prev.Counts[i] // valid: same process, same Go version
    }
    return out
}
```

Both snapshots must come from the same process and Go version, with identical `Buckets`.

### Rate of a cumulative scalar

```go
rate := float64(cur-prev) / interval.Seconds() // bytes/sec, cycles/sec, etc.
```

Branch on `Description.Cumulative` before applying this.

---

## Operational Playbook

| Scenario | Recipe |
|----------|--------|
| Export runtime metrics to Prometheus | Register `collectors.NewGoCollector` with a curated rule set. |
| Build a custom collector | Discover via `All()` once; reuse one `[]Sample`; capture `Kind`/`Cumulative` at build. |
| Keep a histogram across reads | Deep-copy `Counts` and `Buckets` before the next `Read`. |
| Get a windowed quantile | Export native buckets; quantile in PromQL — do not pre-bucket. |
| Survive Go version skew | Intersect wanted names with `All()`; tolerate absent series in dashboards. |
| Diagnose memory growth | Read all `/memory/classes/*`; the largest growing class is the lead. |
| Measure GC CPU tax | `/cpu/classes/gc/total` ÷ `/cpu/classes/total`, rated. |
| Confirm hermetic low-overhead sampling | Reuse `[]Sample`; profile to confirm zero steady-state alloc on the scalar path. |
| Audit the Prometheus mapping | Compare exported series names/types against the `Cumulative`/`Kind` of each source metric. |
| Replace `ReadMemStats` polling | Map fields per the table; drop the stop-the-world read entirely. |

---

## Summary

`runtime/metrics` is a deceptively small package: `All`, `Read`, `Sample`, `Value`. The professional understanding is the contract beneath that surface — `Read` filling a coherent snapshot from per-P runtime counters without a global stop-the-world; `Value` as a tagged union with inline scalars and *shared, reusable* histogram backing; histograms as opaque, version-specific exponential buckets with possibly-infinite outer edges; and a naming/stability contract that makes the metric set discoverable and forward-compatible.

Mastering those layers turns the package from a convenience into precise infrastructure: a discovery-driven, allocation-stable collector; a faithful Prometheus mapping that respects counter/gauge/histogram semantics and native buckets; and a clear model of cost, allocation, and snapshot consistency. The complexity is not in calling `Read` — it is in retaining histograms safely, surviving version skew, and reading the numbers correctly. Knowing where that complexity sits is the professional insight.
