# `runtime/metrics` — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [The API in Full: `All`, `Read`, `Sample`, `Value`](#the-api-in-full-all-read-sample-value)
3. [The Four Value Kinds](#the-four-value-kinds)
4. [Reading Histograms Correctly](#reading-histograms-correctly)
5. [The Metric Families](#the-metric-families)
6. [The `/memory/classes/*` Taxonomy](#the-memoryclasses-taxonomy)
7. [Mapping `MemStats` Fields to Metrics](#mapping-memstats-fields-to-metrics)
8. [Why Metrics Avoid Stop-the-World](#why-metrics-avoid-stop-the-world)
9. [Cumulative vs Instantaneous](#cumulative-vs-instantaneous)
10. [Forward-Compatibility and `KindBad`](#forward-compatibility-and-kindbad)
11. [Building a Reusable Collector](#building-a-reusable-collector)
12. [Common Errors and Their Real Causes](#common-errors-and-their-real-causes)
13. [Best Practices for Real Services](#best-practices-for-real-services)
14. [Pitfalls You Will Meet](#pitfalls-you-will-meet)
15. [Self-Assessment](#self-assessment)
16. [Summary](#summary)

---

## Introduction

You already know the shape of the API: discover with `metrics.All()`, sample with `metrics.Read`, read back through `Value.Kind()`. The middle-level questions are *which metrics exist and what they mean*, *how the value kinds work in detail*, *how histograms decompose*, and *how the new package maps onto the old `MemStats` you may already be reading*.

This file fills in the catalogue and the semantics. After reading you will:
- Know the four `Value` kinds and how to read each safely
- Decode a `Float64Histogram` including open and infinite buckets
- Recognise every major metric family and what it observes
- Understand how `/memory/classes/*` sums to a total
- Translate `MemStats` fields to their metric equivalents
- Explain precisely why metrics avoid stop-the-world and `ReadMemStats` does not
- Write a collector that survives Go version differences

---

## The API in Full: `All`, `Read`, `Sample`, `Value`

The package is intentionally tiny. Four types and two functions carry the whole API.

```go
// Discovery.
func All() []Description

type Description struct {
    Name        string // "/sched/goroutines:goroutines"
    Description string // human-readable text
    Kind        ValueKind
    Cumulative  bool   // true => monotonically increasing counter
}

// Sampling.
func Read(m []Sample)

type Sample struct {
    Name  string // you set this
    Value Value  // Read fills this
}
```

The contract is exact: you fill in each `Sample.Name`, pass the slice to `Read`, and `Read` writes each `Sample.Value`. `Read` does not allocate the slice, reorder it, or error. It matches names against the supported set; unknown names get `Value.Kind() == KindBad`.

`Description.Kind` tells you what kind a value *will* be before you ever read it — useful for pre-validating that you are about to call the right accessor. It will not be `KindBad` (those only appear from `Read` on unknown names); for known metrics it is one of `KindUint64`, `KindFloat64`, `KindFloat64Histogram`.

---

## The Four Value Kinds

`Value` is a tagged union. `Kind()` returns one of:

| Kind | Accessor | Use |
|------|----------|-----|
| `KindUint64` | `Value.Uint64()` | counts and byte sizes (goroutines, heap bytes, GC cycles) |
| `KindFloat64` | `Value.Float64()` | fractional quantities (GOGC-derived limits, some CPU values) |
| `KindFloat64Histogram` | `Value.Float64Histogram()` | distributions (pause times, scheduler latencies) |
| `KindBad` | none | metric not supported on this Go version |

The accessor must match the kind. Calling `Uint64()` on a `KindFloat64Histogram` value panics — this is a programming error, not a runtime condition, so the right defence is a `switch`, never `recover`:

```go
switch s.Value.Kind() {
case metrics.KindUint64:
    handleUint(s.Value.Uint64())
case metrics.KindFloat64:
    handleFloat(s.Value.Float64())
case metrics.KindFloat64Histogram:
    handleHist(s.Value.Float64Histogram())
case metrics.KindBad:
    skip(s.Name)
}
```

A `Value` is cheap to copy and holds the data inline for scalars; for histograms it points at slices that `Read` may reuse on the next call. If you keep a histogram across `Read` calls, copy `Counts` and `Buckets`.

---

## Reading Histograms Correctly

```go
type Float64Histogram struct {
    Counts  []uint64  // length N
    Buckets []float64 // length N+1, bucket boundaries, monotonically increasing
}
```

`Counts[i]` is the number of observations in the half-open interval `[Buckets[i], Buckets[i+1])`. There is always one more boundary than there are counts — the boundaries fence the buckets.

Three semantics that trip people up:

- **Open outer buckets.** `Buckets[0]` can be `math.Inf(-1)` and `Buckets[N]` can be `math.Inf(1)`. The first and last buckets are effectively open-ended. Formatting code must handle infinities.
- **Cumulative observation counts.** For a cumulative histogram (`Description.Cumulative == true`, e.g. `/sched/latencies:seconds`), `Counts` are lifetime totals. To get the distribution *over an interval*, subtract a previous snapshot bucket-by-bucket.
- **Stable bucket boundaries.** Within one Go version the `Buckets` for a given metric do not change between reads, so you can subtract two snapshots element-wise. Do not assume boundaries are identical across Go versions.

Computing an approximate quantile from a cumulative histogram:

```go
func approxQuantile(h *metrics.Float64Histogram, q float64) float64 {
    var total uint64
    for _, c := range h.Counts {
        total += c
    }
    target := uint64(float64(total) * q)
    var cum uint64
    for i, c := range h.Counts {
        cum += c
        if cum >= target {
            return h.Buckets[i+1] // upper edge of the containing bucket
        }
    }
    return h.Buckets[len(h.Buckets)-1]
}
```

This is an upper-bound estimate — bucket granularity caps your precision. For real percentile export, hand the buckets to Prometheus and let the query layer interpolate.

---

## The Metric Families

Metrics group by the first path segment. The major families on Go 1.21+:

### `/gc/*` — garbage collector

- `/gc/heap/allocs:bytes` — cumulative bytes allocated to the heap (counter).
- `/gc/heap/frees:bytes` — cumulative bytes freed from the heap (counter).
- `/gc/heap/allocs:objects`, `/gc/heap/frees:objects` — same, counted in objects.
- `/gc/heap/goal:bytes` — the heap size GC is currently targeting.
- `/gc/cycles/total:gc-cycles` — total completed GC cycles (counter).
- `/gc/cycles/automatic:gc-cycles`, `/gc/cycles/forced:gc-cycles` — split by trigger.
- `/gc/pauses:seconds` — histogram of stop-the-world pause durations.
- `/gc/heap/live:bytes` — bytes considered live by the last GC.
- `/gc/gomemlimit:bytes`, `/gc/gogc:percent` — the active `GOMEMLIMIT` and `GOGC` settings (Go 1.21+).

### `/memory/classes/*` — memory taxonomy

The full accounting of where the process's memory has gone — heap, stacks, OS-reserved metadata. Covered in its own section below.

### `/sched/*` — scheduler

- `/sched/goroutines:goroutines` — live goroutine count (gauge).
- `/sched/latencies:seconds` — histogram of how long goroutines waited between becoming runnable and actually running. A direct signal of scheduling pressure.
- `/sched/gomaxprocs:threads` — the current `GOMAXPROCS` (Go 1.21+).

### `/cpu/*` — CPU time (Go 1.20+)

A breakdown of CPU-seconds the runtime consumed, by category:

- `/cpu/classes/gc/total:cpu-seconds` — CPU spent in GC (mark, assist, etc.).
- `/cpu/classes/scavenge/total:cpu-seconds` — CPU spent returning memory to the OS.
- `/cpu/classes/user:cpu-seconds` — CPU spent running your code.
- `/cpu/classes/idle:cpu-seconds`, `/cpu/classes/total:cpu-seconds` — idle and grand total.

These let you answer "what fraction of CPU is the runtime spending on GC?" without external profiling.

### `/sync/*` — synchronization

- `/sync/mutex/wait/total:seconds` — cumulative time goroutines blocked waiting on `sync.Mutex`/`RWMutex` (Go 1.18+). A lightweight contention signal.

### `/godebug/*` — GODEBUG non-default usage (Go 1.21+)

Counters that tick when a `GODEBUG` setting is used in non-default mode — useful for spotting reliance on legacy behaviour. See [05-godebug-and-runtime-debug](../05-godebug-and-runtime-debug/middle.md).

---

## The `/memory/classes/*` Taxonomy

This family is the modern, complete replacement for the scattered memory fields in `MemStats`. It partitions *all* memory the runtime is accounting for into non-overlapping classes that sum to a total.

The key leaves:

- `/memory/classes/heap/objects:bytes` — memory held by live heap objects.
- `/memory/classes/heap/unused:bytes` — heap memory reserved but not currently holding objects.
- `/memory/classes/heap/free:bytes` — heap memory free and ready to be returned to the OS.
- `/memory/classes/heap/released:bytes` — heap memory already returned to the OS.
- `/memory/classes/heap/stacks:bytes` — memory backing goroutine stacks (heap-allocated stacks).
- `/memory/classes/os-stacks:bytes` — OS-thread stack memory.
- `/memory/classes/metadata/*:bytes` — runtime bookkeeping (mspan, mcache, GC metadata, etc.).
- `/memory/classes/profiling/buckets:bytes` — memory for profiling data structures.
- `/memory/classes/other:bytes` — everything else the runtime maps.
- `/memory/classes/total:bytes` — the sum of all classes; equal to virtual memory the runtime is managing.

The invariant: the individual classes sum exactly to `/memory/classes/total:bytes`. That makes this family a closed accounting — every byte the runtime knows about lands in exactly one class. When debugging "where did my memory go," you read the whole family and the largest class is your answer.

```go
classes := []string{
    "/memory/classes/heap/objects:bytes",
    "/memory/classes/heap/unused:bytes",
    "/memory/classes/heap/free:bytes",
    "/memory/classes/heap/released:bytes",
    "/memory/classes/heap/stacks:bytes",
    "/memory/classes/metadata/mspan/inuse:bytes",
    // ... and the rest, ending with total
    "/memory/classes/total:bytes",
}
```

---

## Mapping `MemStats` Fields to Metrics

If you are migrating from `runtime.ReadMemStats`, this table covers the common fields. The mapping is mostly clean; a few fields aggregate differently.

| `MemStats` field | `runtime/metrics` equivalent |
|------------------|------------------------------|
| `Alloc` / `HeapAlloc` | `/memory/classes/heap/objects:bytes` |
| `TotalAlloc` | `/gc/heap/allocs:bytes` |
| `Sys` | `/memory/classes/total:bytes` |
| `Mallocs` | `/gc/heap/allocs:objects` |
| `Frees` | `/gc/heap/frees:objects` |
| `HeapReleased` | `/memory/classes/heap/released:bytes` |
| `HeapIdle` | `heap/free:bytes` + `heap/released:bytes` |
| `HeapInuse` | `heap/objects:bytes` + `heap/unused:bytes` |
| `StackInuse` / `StackSys` | `/memory/classes/heap/stacks:bytes` (+ `os-stacks`) |
| `NextGC` | `/gc/heap/goal:bytes` |
| `NumGC` | `/gc/cycles/total:gc-cycles` |
| `NumForcedGC` | `/gc/cycles/forced:gc-cycles` |
| `PauseTotalNs` / `PauseNs[]` | `/gc/pauses:seconds` (as a histogram) |
| `LastGC` | (no direct equivalent; derive from cycles + timing) |

The histogram metrics (`/gc/pauses:seconds`) are *strictly richer* than the corresponding `MemStats` fields: `MemStats` gives you a fixed 256-element ring of recent pauses, while the metric gives you a full distribution that the runtime maintains for you.

---

## Why Metrics Avoid Stop-the-World

`runtime.ReadMemStats` must produce a *consistent* snapshot of allocator state. To guarantee no allocation happens mid-read, it stops every goroutine (a stop-the-world pause) for the duration of the copy. On a busy program this pause shows up as latency on every goroutine — exactly the kind of stall you are often trying to *measure*.

`runtime/metrics` is designed to avoid this. Most metrics are read from data the runtime already maintains with atomic or per-P (per-processor) counters that can be aggregated without halting execution. A few aggregate values may briefly coordinate, but the package explicitly avoids the global stop-the-world that `ReadMemStats` requires. The practical upshot: you can sample `runtime/metrics` on a tight cadence in a latency-sensitive service without adding the very pauses you are watching for.

This is the single biggest operational reason to migrate: a periodic `ReadMemStats` is a self-inflicted latency source; the equivalent `runtime/metrics` read is not.

---

## Cumulative vs Instantaneous

`Description.Cumulative` partitions metrics into two behaviours:

- **Cumulative (counters).** Monotonically increasing lifetime totals. `/gc/heap/allocs:bytes`, `/gc/cycles/total:gc-cycles`, the `/cpu/*` totals, `/sync/mutex/wait/total:seconds`. To get a *rate*, difference two readings over a known interval. Cumulative histograms accumulate counts over the program's life.
- **Instantaneous (gauges).** A snapshot of "right now." `/sched/goroutines:goroutines`, every `/memory/classes/*` leaf, `/gc/heap/goal:bytes`. Plot these directly.

Getting this wrong is the classic dashboard bug: graphing a cumulative counter raw shows an ever-climbing line; graphing a gauge as a rate shows noise. Always branch on `Cumulative` when you build the export type:

```go
for _, d := range metrics.All() {
    if d.Cumulative {
        registerAsCounter(d.Name)
    } else {
        registerAsGauge(d.Name)
    }
}
```

---

## Forward-Compatibility and `KindBad`

The metric set grows across Go releases. The package is built so that your code does not break when it runs on a *different* Go version than you developed against — in either direction.

- **Newer binary, your old code.** New metrics simply are not read by you. No harm.
- **Older binary, your newer code.** Names you reference that do not exist yet read back as `KindBad`. You skip them.

The discipline that makes this work:

1. Discover supported names from `metrics.All()` at startup, or
2. Always check `KindBad` after `Read` and degrade gracefully.

A robust collector does both: it builds its sample set by intersecting the metrics it *wants* with the metrics `All()` reports as present, then still tolerates `KindBad` defensively.

```go
want := []string{"/sched/goroutines:goroutines", "/cpu/classes/user:cpu-seconds"}
present := map[string]bool{}
for _, d := range metrics.All() {
    present[d.Name] = true
}
var samples []metrics.Sample
for _, n := range want {
    if present[n] {
        samples = append(samples, metrics.Sample{Name: n})
    }
}
```

Some metrics are documented as *unstable* — their name or semantics may change. Treat the stable subset as your production foundation and the unstable ones as best-effort.

---

## Building a Reusable Collector

A clean middle-level collector packages discovery, validation, and sampling:

```go
type Collector struct {
    samples []metrics.Sample
    kinds   map[string]metrics.ValueKind
}

func NewCollector(names ...string) *Collector {
    present := map[string]metrics.Description{}
    for _, d := range metrics.All() {
        present[d.Name] = d
    }
    c := &Collector{kinds: map[string]metrics.ValueKind{}}
    for _, n := range names {
        if d, ok := present[n]; ok {
            c.samples = append(c.samples, metrics.Sample{Name: n})
            c.kinds[n] = d.Kind
        }
    }
    return c
}

func (c *Collector) Read() []metrics.Sample {
    metrics.Read(c.samples) // reuses the same slice every call
    return c.samples
}
```

Key properties: names are validated once against `All()`, the `[]Sample` is allocated once and reused, and unsupported names are dropped at construction rather than producing `KindBad` at read time. This is the shape that scales into a Prometheus collector (covered at senior level).

---

## Common Errors and Their Real Causes

### Panic: "called Uint64 on a non-uint64 metric value"

You used the wrong accessor for the kind. Cause: skipped the `Kind()` switch, or hard-coded `Uint64()` for a metric that is actually a histogram. Fix: branch on `Kind()`.

### A metric silently reads as zero

Either the metric is a counter that has not ticked yet (no GC has happened), or you typed the name slightly wrong and got `KindBad` (whose accessors would panic, so more likely you guarded it and skipped). Fix: print `Kind()` while debugging; compare the name byte-for-byte against `All()`.

### Histogram percentile looks quantised

Your quantile estimate jumps in steps. Cause: bucket granularity — you are returning bucket edges. This is expected; for finer numbers, export the buckets and let the query engine interpolate. Not a bug.

### Memory classes do not match `top`/`RSS`

`/memory/classes/total:bytes` is what the *Go runtime* maps, not the process RSS the OS reports. cgo allocations, mmap'd files, and OS overhead live outside this accounting. Fix: compare metrics to metrics, RSS to RSS; do not expect them to be identical.

### Rate looks wrong

You graphed a cumulative counter without differencing, or differenced a gauge that should be plotted raw. Fix: branch on `Description.Cumulative`.

---

## Best Practices for Real Services

1. **Validate names against `All()` at startup.** Drop unsupported names then; do not discover them as `KindBad` in the hot path.
2. **Allocate the `[]Sample` once per collector** and reuse it across reads.
3. **Branch export type on `Cumulative`** — counters and gauges are not interchangeable.
4. **Copy histogram slices** if you retain them across `Read` calls.
5. **Respect units** — convert `:seconds` and `:bytes` at the display layer, never silently.
6. **Prefer the stable metric subset** for production dashboards; treat unstable ones as best-effort.
7. **Sample on a coarse cadence** (seconds), not in a tight loop.
8. **Use the standard library's Prometheus collector** if you already run Prometheus, rather than re-implementing it.

---

## Pitfalls You Will Meet

### Pitfall 1 — Retaining a histogram across reads

`Read` may reuse the `Counts`/`Buckets` backing arrays. If you store the `Float64Histogram` and read again, your stored copy mutates. Copy the slices before the next `Read`.

### Pitfall 2 — Assuming bucket boundaries match across Go versions

Subtracting two snapshots is valid within one process/Go version. Across versions, boundaries can differ; do not persist buckets and diff them against a newer binary's output.

### Pitfall 3 — Expecting `/cpu/*` on Go 1.19

The CPU family is 1.20+. On older binaries every `/cpu/*` name is `KindBad`. Guard for it.

### Pitfall 4 — Treating `/memory/classes/total:bytes` as RSS

It is the runtime's mapped memory, not the OS-reported resident set. They correlate but are not equal.

### Pitfall 5 — Reading the whole `All()` set every tick

`metrics.Read` cost scales with sample count. Passing every metric on every scrape wastes work; pass only what you export.

### Pitfall 6 — Forgetting that cumulative histograms need differencing

`/sched/latencies:seconds` accumulates for the program's life. The "latency in the last minute" requires subtracting a one-minute-old snapshot bucket-by-bucket.

---

## Self-Assessment

You can move on to [senior.md](senior.md) when you can:

- [ ] Describe `All`, `Read`, `Sample`, and `Value` and their exact contract
- [ ] Name the four value kinds and the accessor for each
- [ ] Read a `Float64Histogram`, including open/infinite buckets and the `N+1` rule
- [ ] List the `/gc/*`, `/memory/classes/*`, `/sched/*`, `/cpu/*`, and `/sync/*` families
- [ ] Explain how `/memory/classes/*` sums to a total
- [ ] Map the common `MemStats` fields to their metric equivalents
- [ ] Explain precisely why `runtime/metrics` avoids stop-the-world and `ReadMemStats` does not
- [ ] Branch correctly on `Cumulative` when exporting
- [ ] Build a collector that validates names via `All()` and reuses its `[]Sample`
- [ ] Handle Go version skew via `KindBad` and `All()`

---

## Summary

`runtime/metrics` exposes a small, exact API — `All` for discovery, `Read` for sampling, `Sample`/`Value` as the data carriers — over a growing catalogue of self-describing metrics. Values come in four kinds (`Uint64`, `Float64`, `Float64Histogram`, `Bad`), and each demands the matching accessor; histograms decompose into `Counts` (length N) and `Buckets` (length N+1) with possibly-infinite outer edges.

The catalogue groups by family: `/gc/*` for the collector, `/memory/classes/*` for a closed memory accounting that sums to a total, `/sched/*` for goroutine and scheduler signals, `/cpu/*` for CPU-time breakdown, `/sync/*` for contention. Most `MemStats` fields map cleanly to metrics, and the histograms are strictly richer than what `MemStats` ever offered. Crucially, sampling avoids the stop-the-world pause that `ReadMemStats` imposes, which is the main reason to migrate.

Build collectors that validate names against `All()`, reuse one `[]Sample`, branch export type on `Cumulative`, and tolerate `KindBad` for version skew. Get those four habits right and the package becomes a reliable, low-cost foundation for runtime observability.
