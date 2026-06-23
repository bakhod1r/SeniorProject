# `runtime/metrics` — Optimization

> Honest framing first: `metrics.Read` is a cheap aggregation over counters the runtime already maintains. The command itself is rarely the bottleneck — the genuinely worthwhile optimizations are in the *workflow* around it: how often you sample, how many metrics you pass, whether you reuse the sample slice, how histograms are copied, how the data is exported to Prometheus/OTel, and whether you should be reading `MemStats` at all anymore. Each entry below states the problem, shows a "before" and "after", and the realistic gain. The closing sections cover measurement and when reaching for `runtime/metrics` is the wrong tool.

---

## Optimization 1 — Reuse the `[]Sample` slice

**Problem:** A collector that allocates a fresh `[]metrics.Sample` on every read produces garbage proportional to its sampling rate — ironic in a tool used to watch the GC. The allocation also touches the heap on the very path you want to keep quiet.

**Before:**
```go
func snapshot() {
    s := []metrics.Sample{
        {Name: "/sched/goroutines:goroutines"},
        {Name: "/memory/classes/heap/objects:bytes"},
    }
    metrics.Read(s)
    publish(s)
}
```
Every call allocates the slice and its backing array.

**After:**
```go
var s = []metrics.Sample{
    {Name: "/sched/goroutines:goroutines"},
    {Name: "/memory/classes/heap/objects:bytes"},
}
func snapshot() {
    metrics.Read(s) // overwrites Value fields in place
    publish(s)
}
```

**Expected gain:** Scalar reads become steady-state allocation-free (`0 allocs/op` under `-benchmem`). On a high-frequency sampler this removes thousands of tiny allocations per minute and the GC work that follows them.

---

## Optimization 2 — Sample only the metrics you export

**Problem:** Passing the entire `metrics.All()` set to `Read` on every scrape reads dozens of metrics — including histograms that copy slices — when you only graph a handful.

**Before:**
```go
descs := metrics.All()
s := make([]metrics.Sample, len(descs))
for i, d := range descs {
    s[i].Name = d.Name
}
metrics.Read(s) // reads everything, every scrape
```

**After:**
```go
var want = []string{
    "/sched/goroutines:goroutines",
    "/gc/pauses:seconds",
    "/memory/classes/heap/objects:bytes",
}
var s []metrics.Sample
func init() {
    present := map[string]bool{}
    for _, d := range metrics.All() {
        present[d.Name] = true
    }
    for _, n := range want {
        if present[n] {
            s = append(s, metrics.Sample{Name: n})
        }
    }
}
```

**Expected gain:** `Read` cost is linear in sample count and dominated by histograms; cutting from "all metrics" to a curated set drops both CPU and the per-histogram slice copy. On a busy scrape path this is the single biggest `Read`-side win.

---

## Optimization 3 — Discover once, not on every scrape

**Problem:** `metrics.All()` builds a fresh `[]Description` each call. Calling it per scrape (to rebuild the sample slice) wastes allocation and CPU — the supported set never changes during a process's lifetime.

**Before:**
```go
func collect() []metrics.Sample {
    descs := metrics.All()                  // rebuilt every scrape
    s := make([]metrics.Sample, len(descs)) // reallocated every scrape
    // ...
}
```

**After:**
```go
var s []metrics.Sample // built once in init/New, reused forever
func collect() []metrics.Sample {
    metrics.Read(s)
    return s
}
```

**Expected gain:** Eliminates a per-scrape allocation of the descriptions slice plus the sample slice rebuild. The supported set is process-stable, so there is nothing to re-discover.

---

## Optimization 4 — Copy histograms only when you keep them

**Problem:** Histograms are the priciest values to handle because `Float64Histogram()` exposes slices that `Read` may reuse. Code that defensively deep-copies every histogram on every read allocates needlessly when it only consumes the distribution inline.

**Before:**
```go
metrics.Read(s)
h := s[0].Value.Float64Histogram()
counts := append([]uint64(nil), h.Counts...)   // copy even though...
buckets := append([]float64(nil), h.Buckets...) // ...we use it immediately
p99 := approxQuantile(counts, buckets, 0.99)
```

**After (copy only when retaining across a future `Read`):**
```go
metrics.Read(s)
h := s[0].Value.Float64Histogram()
p99 := approxQuantile(h.Counts, h.Buckets, 0.99) // consume inline, no copy

// Copy ONLY if you store it for a later windowed delta:
prevCounts := append([]uint64(nil), h.Counts...)
```

**Expected gain:** Removes one slice copy per histogram per read on the common "consume immediately" path. Copy remains necessary only when you snapshot for a later subtraction.

---

## Optimization 5 — Sample on a coarse cadence, cache the result

**Problem:** Sampling slowly-changing process-global metrics at high frequency (or per request) adds overhead for no extra signal. Goroutine count and heap size do not meaningfully change microsecond to microsecond.

**Before:**
```go
func handler(w http.ResponseWriter, r *http.Request) {
    metrics.Read(perRequestSamples) // every request reads runtime metrics
    // ...
}
```

**After:**
```go
var goroutines atomic.Uint64
func startSampler() {
    s := []metrics.Sample{{Name: "/sched/goroutines:goroutines"}}
    go func() {
        for range time.Tick(time.Second) {
            metrics.Read(s)
            goroutines.Store(s[0].Value.Uint64())
        }
    }()
}
func handler(w http.ResponseWriter, r *http.Request) {
    _ = goroutines.Load() // cheap atomic read, no Read per request
}
```

**Expected gain:** Moves `Read` off the hot path entirely. Per-request cost drops to a single atomic load; the runtime is sampled once per second regardless of request volume.

---

## Optimization 6 — Replace periodic `ReadMemStats` to remove stop-the-world

**Problem:** A periodic `runtime.ReadMemStats` injects a global stop-the-world pause on every read. On a latency-sensitive service this is a self-inflicted tail-latency source — you stall every goroutine to measure memory.

**Before:**
```go
var ms runtime.MemStats
for range time.Tick(time.Second) {
    runtime.ReadMemStats(&ms) // stops the world each second
    publishHeap(ms.HeapAlloc)
}
```

**After:**
```go
s := []metrics.Sample{{Name: "/memory/classes/heap/objects:bytes"}}
for range time.Tick(time.Second) {
    metrics.Read(s) // no stop-the-world
    publishHeap(s[0].Value.Uint64())
}
```

**Expected gain:** Eliminates a periodic global pause. On a high-goroutine service the removed pauses show up directly as reduced p99/p999 latency — often the most impactful change in this whole list.

---

## Optimization 7 — Read mutually-dependent metrics in one call

**Problem:** Computing a derived value (e.g. live bytes ≈ allocs − frees) from two separate `Read` calls reads two different instants. Besides being incorrect, it doubles the `Read` overhead.

**Before:**
```go
metrics.Read([]metrics.Sample{{Name: "/gc/heap/allocs:bytes"}})
metrics.Read([]metrics.Sample{{Name: "/gc/heap/frees:bytes"}})
```

**After:**
```go
s := []metrics.Sample{
    {Name: "/gc/heap/allocs:bytes"},
    {Name: "/gc/heap/frees:bytes"},
}
metrics.Read(s) // one coherent snapshot, one call
live := s[0].Value.Uint64() - s[1].Value.Uint64()
```

**Expected gain:** Halves the `Read` calls and yields a coherent snapshot. Correctness and performance improve together.

---

## Optimization 8 — Use the standard Prometheus collector, read-on-scrape

**Problem:** A hand-rolled exporter that samples on a background ticker and pushes into Prometheus gauges duplicates work and risks sampling at a different cadence than the scrape, producing staleness or double-reads.

**Before:**
```go
go func() {
    for range time.Tick(5 * time.Second) {
        metrics.Read(samples)
        for i := range samples { gauges[i].Set(asFloat(samples[i].Value)) }
    }
}()
```
Sampled every 5s regardless of scrape interval; values can be stale or read twice.

**After:**
```go
reg.MustRegister(collectors.NewGoCollector(
    collectors.WithGoCollectorRuntimeMetrics(
        collectors.GoRuntimeMetricsRule{Matcher: regexp.MustCompile(`^/(sched|gc)/.*`)},
    ),
))
```
The collector reads `runtime/metrics` *on scrape*, so cost is exactly `scrape_freq × exported_metrics` and values are never stale relative to the scrape.

**Expected gain:** One read per scrape instead of an independent ticker; correct counter/gauge/histogram types for free; no staleness window. Less code, fewer bugs, bounded cost.

---

## Optimization 9 — Curate exported metrics to bound fleet cardinality

**Problem:** Exporting `MetricsAll` ships dozens of series per process; histograms expand into many bucket series. Multiplied across a large fleet this dominates TSDB storage and query cost — for metrics nobody graphs.

**Before:**
```go
collectors.WithGoCollectorRuntimeMetrics(collectors.MetricsAll)
// dozens of series × N instances; histograms multiply
```

**After:**
```go
collectors.WithGoCollectorRuntimeMetrics(
    collectors.GoRuntimeMetricsRule{Matcher: regexp.MustCompile(`^/sched/latencies:seconds$`)},
    collectors.GoRuntimeMetricsRule{Matcher: regexp.MustCompile(`^/gc/pauses:seconds$`)},
    collectors.GoRuntimeMetricsRule{Matcher: regexp.MustCompile(`^/memory/classes/heap/objects:bytes$`)},
    collectors.GoRuntimeMetricsRule{Matcher: regexp.MustCompile(`^/cpu/classes/(gc|total)/.*`)},
)
```

**Expected gain:** Active series for runtime data drops by an order of magnitude on a large fleet, cutting scrape bandwidth, TSDB storage, and dashboard query latency. Push the full dump to an on-demand `/debug/metrics` endpoint instead.

---

## Optimization 10 — Prefer native histograms over classic buckets

**Problem:** Classic Prometheus histograms emit one series per bucket boundary; the runtime's pause and latency histograms have many buckets, so each becomes a fat fan-out of series.

**Before:** Classic histogram export — each runtime histogram becomes `_bucket` series for every boundary, multiplied by instance count.

**After:** Enable native (sparse) histograms in the client and scrape config so the runtime's exponential buckets are carried compactly:
```go
// client_golang with native histogram support; the GoCollector maps
// runtime histograms to native histograms where enabled.
prometheus.NewRegistry() // + native-histogram-enabled scrape config
```

**Expected gain:** A single native histogram series replaces dozens of classic `_bucket` series per metric per instance — a large reduction in series count for the histogram-heavy runtime metrics, while preserving the runtime's actual bucket resolution.

---

## Optimization 11 — Validate names at startup, drop `KindBad` from the hot path

**Problem:** A collector that reads names which may be unsupported pays a `KindBad` branch on every read and risks a panic if any code path forgets the guard. The check belongs at construction, once.

**Before:**
```go
func collect() {
    metrics.Read(s)
    for i := range s {
        if s[i].Value.Kind() == metrics.KindBad { continue } // every scrape
        emit(s[i])
    }
}
```

**After:**
```go
func New(want []string) *Collector {
    present := map[string]bool{}
    for _, d := range metrics.All() { present[d.Name] = true }
    var s []metrics.Sample
    for _, n := range want {
        if present[n] { s = append(s, metrics.Sample{Name: n}) }
    }
    return &Collector{samples: s}
}
// collect() never sees KindBad — unsupported names were dropped once.
```

**Expected gain:** Removes the per-scrape `KindBad` branch and eliminates a class of accessor panics. Version-robustness is handled once, not on every read.

---

## Optimization 12 — Don't re-bucket runtime histograms

**Problem:** Re-binning the runtime's histogram into your own SLO boundaries (by reading `Counts`/`Buckets` and re-counting) both loses precision and burns CPU on every scrape.

**Before:**
```go
h := s[0].Value.Float64Histogram()
myBuckets := rebin(h, []float64{0.005, 0.01, 0.025, 0.05}) // lossy + costly
export(myBuckets)
```

**After:**
```go
// Export the runtime's native buckets as-is; quantile in PromQL.
// histogram_quantile(0.99, rate(go_gc_pauses_seconds_bucket[5m]))
```

**Expected gain:** Removes per-scrape re-bucketing CPU and preserves the runtime's full resolution. The query engine does the windowing and interpolation — correctly and lazily, only when queried.

---

## Optimization 13 — Gate the full-dump debug endpoint

**Problem:** A `/debug/metrics` handler that reads and serialises *every* metric is useful for investigation but expensive if it's hot or public. Left on a scrape path it reads all histograms on every request.

**Before:** `/metrics` and `/debug/metrics` both read the full set; scrapers hit the heavy one.

**After:**
```go
mux.Handle("/metrics", promHandler)          // curated, scraped
mux.Handle("/debug/metrics", authOnly(dump)) // full dump, on-demand only
```

**Expected gain:** The steady-state scrape stays curated and cheap; the full dump is reserved for human investigation behind auth, so the heavy all-histogram read happens rarely, not on every scrape.

---

## Optimization 14 — Stop reading metrics you compute from elsewhere

**Problem:** Reading `/sched/goroutines:goroutines` via the full sampling machinery when you only need a quick count, or duplicating a value already exported by the collector, is redundant work.

**Before:**
```go
s := []metrics.Sample{{Name: "/sched/goroutines:goroutines"}}
metrics.Read(s)
n := s[0].Value.Uint64()
```

**After (when you just need the count, not the metrics pipeline):**
```go
n := runtime.NumGoroutine() // direct, no Sample/Read/Kind machinery
```

**Expected gain:** For one-off counts, `runtime.NumGoroutine()` is a single cheap call with no slice or `Kind` handling. Reserve `runtime/metrics` for the values that have no direct accessor (histograms, memory classes, CPU breakdown) or when you're feeding a metrics pipeline.

---

## Benchmarking and Measurement

Optimization without measurement is folklore. For `runtime/metrics` workflows the most useful signals are:

```go
// Per-op cost and allocations of a Read over your real sample set:
func BenchmarkRead(b *testing.B) {
    s := buildSamples() // your curated set
    b.ReportAllocs()
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        metrics.Read(s)
    }
}
```

```bash
# Allocations: scalar-only reads with a reused slice should be 0 allocs/op.
go test -bench=BenchmarkRead -benchmem

# Exported series count (the fleet-cardinality cost):
curl -s localhost:8080/metrics | grep '^go_' | wc -l

# Confirm the migration removed stop-the-world: compare p99 latency
# before/after dropping periodic ReadMemStats under load.
```

Track two metrics in particular: **allocations per read** (should be zero on the scalar path with a reused slice) and **exported series count × instance count** (the dominant fleet cost). A change that does not move either is not an optimization.

---

## When `runtime/metrics` Is the Wrong Tool

`runtime/metrics` is the right tool for *aggregate, always-on, process-global* observability. It is the wrong tool when:

- **You need per-call-site detail.** "Which function allocates the most" is a `pprof` heap profile, not a metric. Metrics tell you *that* the heap grew; the profiler tells you *where*.
- **You need per-goroutine or per-event timelines.** That is execution tracing (`runtime/trace`), not aggregate metrics.
- **You just need one quick number locally.** `runtime.NumGoroutine()` or a one-off `MemStats` field is faster to type than the `Sample`/`Read`/`Kind` dance.
- **You want to change runtime behaviour.** Tuning is `GOGC`/`GOMEMLIMIT`/`runtime/debug`, not this read-only package. See [05-godebug-and-runtime-debug](../05-godebug-and-runtime-debug/optimize.md).
- **You're tempted to sample per request.** These metrics are global; per-request reads add cost for no per-request signal — cache a background sample instead.

Use `runtime/metrics` as the cheap, continuous layer that triggers alerts and narrows hypotheses, then reach for profiling or tracing to confirm. Spend the effort you'd waste over-sampling or hand-rolling exporters on curating the handful of metrics that actually map to your SLOs.

---

## Summary

`metrics.Read` is not slow; the workflows around it are. The wins come from treating sampling as a *cache strategy*: reuse the `[]Sample` slice so scalar reads are allocation-free, sample only the curated metrics you export, discover via `All()` once at startup, copy histograms only when you retain them, read mutually-dependent metrics in one coherent call, and sample on a coarse cadence with cached results rather than per request. On the export side, let `NewGoCollector` read on scrape with correct types, curate the exported set and prefer native histograms to bound fleet cardinality, and quantile in the query layer instead of re-bucketing.

The biggest single win is often upstream of all of these: replacing periodic `ReadMemStats` removes a self-inflicted stop-the-world pause that shows up directly as tail latency. And the most important judgement is knowing when *not* to reach for metrics at all — for per-site detail use profiling, for timelines use tracing, for a quick count use the direct runtime accessor. Curate, reuse, sample coarsely, export correctly, and `runtime/metrics` stays in the noise while telling you exactly where to point the expensive tools.
