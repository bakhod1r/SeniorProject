# `runtime/metrics` — Find the Bug

> Each snippet contains a real-world bug related to reading Go runtime metrics. `runtime/metrics` exposes named, self-describing metrics (`/gc/heap/allocs:bytes`, `/sched/goroutines:goroutines`) discovered via `metrics.All()` and sampled with `metrics.Read([]Sample)`; each `Value` carries a `Kind` (`Uint64`, `Float64`, `Float64Histogram`, `Bad`) and must be read with the matching accessor. Find the bug, explain it, fix it.

---

## Bug 1 — Reading a value without checking `Kind()`

```go
s := []metrics.Sample{{Name: "/gc/pauses:seconds"}}
metrics.Read(s)
fmt.Println(s[0].Value.Uint64())
// panic: runtime/metrics: unexpected metric Kind
```

**Bug:** `/gc/pauses:seconds` is a `Float64Histogram`, not a `Uint64`. Calling `Uint64()` on a histogram value panics — the accessor is a checked type assertion with no error return.

**Fix:** always branch on `Kind()` before reading:

```go
metrics.Read(s)
switch s[0].Value.Kind() {
case metrics.KindFloat64Histogram:
    h := s[0].Value.Float64Histogram()
    _ = h
case metrics.KindUint64:
    _ = s[0].Value.Uint64()
}
```

Check the metric's `Kind` in `metrics.All()` (or the package docs) before writing the accessor.

---

## Bug 2 — Typo in the metric name read as zero

```go
s := []metrics.Sample{{Name: "/sched/goroutines"}} // missing :goroutines unit
metrics.Read(s)
if s[0].Value.Kind() == metrics.KindUint64 {
    fmt.Println("goroutines:", s[0].Value.Uint64())
}
// prints nothing — the if is never true
```

**Bug:** The unit suffix is part of the name. `/sched/goroutines` without `:goroutines` is not a real metric, so `Read` returns `KindBad`. The `if` silently never fires, and the developer thinks "no goroutines" when really the name was wrong.

**Fix:** include the full name, colon and unit included, and handle `KindBad` explicitly:

```go
const goroutines = "/sched/goroutines:goroutines"
s := []metrics.Sample{{Name: goroutines}}
metrics.Read(s)
if s[0].Value.Kind() == metrics.KindBad {
    log.Fatalf("metric %q not supported", goroutines)
}
```

Store names as constants so a typo is visible at the call site.

---

## Bug 3 — Allocating the sample slice inside the loop

```go
for range time.Tick(time.Second) {
    s := []metrics.Sample{
        {Name: "/sched/goroutines:goroutines"},
        {Name: "/memory/classes/heap/objects:bytes"},
    }
    metrics.Read(s)
    log.Println(s[0].Value.Uint64(), s[1].Value.Uint64())
}
```

**Bug:** A fresh `[]Sample` (and its backing array) is allocated every tick. In a metrics-reading loop this generates needless garbage — the exact thing you're trying to observe. `Read` only overwrites the `Value` fields; the `Name`s never change.

**Fix:** hoist the slice out of the loop and reuse it:

```go
s := []metrics.Sample{
    {Name: "/sched/goroutines:goroutines"},
    {Name: "/memory/classes/heap/objects:bytes"},
}
for range time.Tick(time.Second) {
    metrics.Read(s) // reuses storage
    log.Println(s[0].Value.Uint64(), s[1].Value.Uint64())
}
```

---

## Bug 4 — Off-by-one indexing histogram buckets

```go
h := s[0].Value.Float64Histogram()
for i := range h.Counts {
    lo := h.Buckets[i]
    hi := h.Buckets[i]   // BUG: same index, zero-width range
    fmt.Printf("[%g,%g): %d\n", lo, hi, h.Counts[i])
}
```

**Bug:** `Counts[i]` covers `[Buckets[i], Buckets[i+1])`. Using `Buckets[i]` for both edges prints a zero-width range. The upper edge must be `Buckets[i+1]`. This works because `len(Buckets) == len(Counts)+1`, so `i+1` is always in range.

**Fix:**

```go
for i := range h.Counts {
    lo, hi := h.Buckets[i], h.Buckets[i+1]
    fmt.Printf("[%g,%g): %d\n", lo, hi, h.Counts[i])
}
```

---

## Bug 5 — Plotting a cumulative counter as a gauge

```go
// exported to a dashboard as a gauge
gauge.Set(float64(readUint("/gc/heap/allocs:bytes")))
// dashboard shows an ever-climbing line that never drops
```

**Bug:** `/gc/heap/allocs:bytes` is cumulative (`Description.Cumulative == true`) — total bytes ever allocated. Setting a gauge to it produces a monotonically rising line; "allocation rate" requires differencing consecutive readings.

**Fix:** export cumulative metrics as counters and rate them in the query layer (or difference manually):

```go
// Prometheus: register as a Counter; PromQL rate() gives bytes/sec.
counter.Add(float64(cur - prev)) // if differencing by hand
```

Branch on `Description.Cumulative` when choosing the export type.

---

## Bug 6 — Retaining a histogram across reads

```go
metrics.Read(s)
prev := s[0].Value.Float64Histogram() // pointer into reusable storage
time.Sleep(time.Minute)
metrics.Read(s)                        // overwrites prev's backing arrays!
cur := s[0].Value.Float64Histogram()
delta := cur.Counts[0] - prev.Counts[0] // prev was mutated; delta is wrong (0)
```

**Bug:** `Read` may reuse the storage backing a histogram. Retaining `prev` and reading again mutates `prev.Counts`/`prev.Buckets` underneath you, so the delta is wrong (often zero).

**Fix:** deep-copy the histogram before the next `Read`:

```go
metrics.Read(s)
h := s[0].Value.Float64Histogram()
prevCounts := append([]uint64(nil), h.Counts...)
prevBuckets := append([]float64(nil), h.Buckets...)
// ... later ...
metrics.Read(s)
cur := s[0].Value.Float64Histogram()
delta := cur.Counts[0] - prevCounts[0]
_ = prevBuckets
```

---

## Bug 7 — Assuming `/cpu/*` exists on every Go version

```go
s := []metrics.Sample{{Name: "/cpu/classes/gc/total:cpu-seconds"}}
metrics.Read(s)
gcCPU := s[0].Value.Float64() // panics on Go 1.19: value is KindBad
```

**Bug:** The `/cpu/*` family was added in Go 1.20. On 1.19 and earlier, the name reads as `KindBad`, and `Float64()` on a `KindBad` value panics. The code assumes a metric that may not exist.

**Fix:** check `Kind()` (or validate against `All()` at startup) before reading:

```go
metrics.Read(s)
if s[0].Value.Kind() == metrics.KindFloat64 {
    gcCPU := s[0].Value.Float64()
    _ = gcCPU
}
```

Better: intersect wanted names with `metrics.All()` at startup so unsupported names never reach `Read`.

---

## Bug 8 — Confusing "allocated ever" with "live now"

```go
// "how much heap am I using right now?"
liveHeap := readUint("/gc/heap/allocs:bytes")
```

**Bug:** `/gc/heap/allocs:bytes` is *cumulative bytes ever allocated* — it grows without bound and is not current usage. The "live now" metric is `/memory/classes/heap/objects:bytes` (a gauge).

**Fix:**

```go
liveHeap := readUint("/memory/classes/heap/objects:bytes") // current live bytes
```

When in doubt, read `Description.Cumulative`: a `true` value is a lifetime total, not a snapshot.

---

## Bug 9 — Treating `/memory/classes/total:bytes` as process RSS

```go
total := readUint("/memory/classes/total:bytes")
if total > containerLimitBytes {
    log.Println("over memory limit") // fires inconsistently vs the OOM killer
}
```

**Bug:** `/memory/classes/total:bytes` is the memory the *Go runtime* maps, not the OS resident set (RSS). cgo allocations, mmap'd files, and OS overhead live outside this accounting, so it under-reports relative to what the container's OOM killer sees.

**Fix:** compare against the right quantity. For OOM headroom use `GOMEMLIMIT` and the OS-reported RSS (cgroup memory stats); use the metric for *runtime-managed* memory analysis:

```go
// For OOM safety, set a runtime memory limit instead:
debug.SetMemoryLimit(containerLimitBytes * 9 / 10)
// and observe /gc/gomemlimit:bytes to confirm.
```

Don't equate runtime-mapped bytes with RSS.

---

## Bug 10 — Not differencing a cumulative histogram

```go
metrics.Read(s)
h := s[0].Value.Float64Histogram() // /sched/latencies:seconds (cumulative)
p99 := approxQuantile(h, 0.99)      // "p99 over the last minute"
```

**Bug:** `/sched/latencies:seconds` is cumulative — `Counts` are lifetime totals. Computing a quantile over the raw histogram gives the *all-time* distribution, not the last minute. Recent regressions are drowned by historical data.

**Fix:** subtract a prior snapshot to get the windowed distribution:

```go
delta := make([]uint64, len(cur.Counts))
for i := range cur.Counts {
    delta[i] = cur.Counts[i] - prev.Counts[i] // same Buckets, same Go version
}
p99 := approxQuantileFromCounts(delta, cur.Buckets, 0.99)
```

---

## Bug 11 — Hand-rolling the Prometheus type mapping wrong

```go
for _, d := range metrics.All() {
    // export everything as a gauge
    g := prometheus.NewGauge(prometheus.GaugeOpts{Name: sanitize(d.Name)})
    reg.MustRegister(g)
}
```

**Bug:** Exporting *every* metric as a gauge mislabels the cumulative ones (counters) and ignores histograms entirely. `rate()` over a "gauge" that's really a counter is meaningless, and histogram metrics get dropped or crash the gauge `.Set` (wrong kind).

**Fix:** use the standard collector, which gets the mapping right:

```go
reg.MustRegister(collectors.NewGoCollector(
    collectors.WithGoCollectorRuntimeMetrics(
        collectors.GoRuntimeMetricsRule{Matcher: regexp.MustCompile(`.*`)},
    ),
))
```

If you must hand-roll, branch on `Description.Cumulative` (counter vs gauge) and handle `KindFloat64Histogram` as a Prometheus `Histogram`.

---

## Bug 12 — Reading `MemStats` periodically "for safety" alongside metrics

```go
go func() {
    var ms runtime.MemStats
    for range time.Tick(time.Second) {
        runtime.ReadMemStats(&ms) // stops the world every second
        publishMemStats(ms)
    }
}()
// ... plus the runtime/metrics collector elsewhere
```

**Bug:** The whole point of migrating to `runtime/metrics` is to stop paying `ReadMemStats`'s stop-the-world cost. Keeping a per-second `ReadMemStats` reintroduces a periodic global pause — a self-inflicted latency source — defeating the migration.

**Fix:** drop the `ReadMemStats` polling; read the equivalents from `runtime/metrics`, which don't stop the world:

```go
s := []metrics.Sample{
    {Name: "/memory/classes/heap/objects:bytes"}, // ~ HeapAlloc
    {Name: "/gc/heap/allocs:bytes"},              // ~ TotalAlloc
}
for range time.Tick(time.Second) {
    metrics.Read(s)
    publish(s)
}
```

---

## Bug 13 — Exporting the full metric set on a large fleet

```go
reg.MustRegister(collectors.NewGoCollector(
    collectors.WithGoCollectorRuntimeMetrics(collectors.MetricsAll),
))
// 2,000 instances × dozens of series (histograms multiply) → TSDB blowup
```

**Bug:** `MetricsAll` exports every runtime metric, including histograms that expand into many bucket series. Multiplied across a large fleet, this balloons active series, scrape bandwidth, and query cost — for metrics nobody dashboards.

**Fix:** curate to what you alert on and graph:

```go
reg.MustRegister(collectors.NewGoCollector(
    collectors.WithGoCollectorRuntimeMetrics(
        collectors.GoRuntimeMetricsRule{Matcher: regexp.MustCompile(`^/sched/latencies:seconds$`)},
        collectors.GoRuntimeMetricsRule{Matcher: regexp.MustCompile(`^/gc/(pauses:seconds|cycles/total:gc-cycles)$`)},
        collectors.GoRuntimeMetricsRule{Matcher: regexp.MustCompile(`^/memory/classes/heap/objects:bytes$`)},
    ),
))
```

Push the full dump to an on-demand `/debug/metrics` endpoint instead.

---

## Bug 14 — Sampling metrics in the request hot path

```go
func handler(w http.ResponseWriter, r *http.Request) {
    s := []metrics.Sample{{Name: "/sched/goroutines:goroutines"}}
    metrics.Read(s) // per request!
    w.Header().Set("X-Goroutines", strconv.FormatUint(s[0].Value.Uint64(), 10))
    // ...
}
```

**Bug:** These are process-global metrics; sampling them per request adds an allocation and a `Read` to every request for a value that changes slowly and isn't request-specific. It inflates latency and garbage under load for no signal.

**Fix:** sample on a background ticker and cache the latest value:

```go
var goroutines atomic.Uint64
func init() {
    s := []metrics.Sample{{Name: "/sched/goroutines:goroutines"}}
    go func() {
        for range time.Tick(time.Second) {
            metrics.Read(s)
            goroutines.Store(s[0].Value.Uint64())
        }
    }()
}
func handler(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("X-Goroutines", strconv.FormatUint(goroutines.Load(), 10))
}
```

---

## Bug 15 — Assuming bucket boundaries are stable across Go versions

```go
// snapshot persisted from a Go 1.20 instance, diffed on a Go 1.21 instance
delta[i] = cur.Counts[i] - persistedPrevCounts[i]
```

**Bug:** Histogram bucket *boundaries* (`Buckets`) can change between Go versions. Subtracting counts from a snapshot taken on a different Go version (different bucket layout) aligns the wrong buckets, producing garbage deltas — or an index mismatch if the lengths differ.

**Fix:** only difference snapshots taken within the *same* process and Go version. Verify boundaries match before subtracting:

```go
if len(cur.Buckets) != len(prev.Buckets) || cur.Buckets[0] != prev.Buckets[0] {
    log.Fatal("bucket layout changed; cannot diff across versions")
}
```

Don't persist histogram snapshots across deploys for differencing.

---

## Bug 16 — Misreading the unit (`:seconds` treated as nanoseconds)

```go
h := s[0].Value.Float64Histogram() // /gc/pauses:seconds
worstPauseNs := h.Buckets[len(h.Buckets)-1] // labelled "ns" in the dashboard
```

**Bug:** `/gc/pauses:seconds` is in **seconds** (a `float64` like `0.0008` for 0.8 ms). Treating the value as nanoseconds inflates every number by 1e9 on the dashboard. The unit is in the name: `:seconds`.

**Fix:** respect the unit suffix; convert explicitly at display time:

```go
worstPauseSeconds := h.Buckets[len(h.Buckets)-1]
worstPauseMs := worstPauseSeconds * 1000
```

Name your variables with the unit (`pauseSeconds`) so the conversion is obvious.

---

## Bug 17 — Calling `All()` on every scrape

```go
func collect() []metrics.Sample {
    descs := metrics.All()                      // re-discovered every scrape
    s := make([]metrics.Sample, len(descs))     // re-allocated every scrape
    for i, d := range descs {
        s[i].Name = d.Name
    }
    metrics.Read(s)
    return s
}
```

**Bug:** `metrics.All()` builds a fresh `[]Description` each call, and re-allocating the full sample slice every scrape is wasteful — the supported set never changes during a process's life. This reads *every* metric (including unneeded histograms) on every scrape.

**Fix:** discover once at startup, build the (curated) sample slice once, reuse it:

```go
var samples []metrics.Sample
func init() {
    for _, d := range metrics.All() {
        if want[d.Name] {
            samples = append(samples, metrics.Sample{Name: d.Name})
        }
    }
}
func collect() []metrics.Sample {
    metrics.Read(samples)
    return samples
}
```

---

## Bug 18 — Crashing on an empty (all-zero) histogram

```go
h := s[0].Value.Float64Histogram()
total := sum(h.Counts)
mean := weightedMean(h) / float64(total) // division by zero early in process life
```

**Bug:** Before any GC has happened, `/gc/pauses:seconds` is a valid histogram with all-zero `Counts`. `total` is 0, and dividing by it yields `NaN`/`+Inf` (or a panic if you guard with integer division). An empty histogram is not an error — it's "no data yet."

**Fix:** guard for the empty case:

```go
total := sum(h.Counts)
if total == 0 {
    return 0, false // no observations yet
}
mean := weightedMean(h) / float64(total)
```

---

## Bug 19 — Sharing one `[]Sample` across concurrent readers

```go
var shared = []metrics.Sample{{Name: "/sched/goroutines:goroutines"}}

func reader() uint64 {
    metrics.Read(shared)         // two goroutines call this concurrently
    return shared[0].Value.Uint64()
}
```

**Bug:** `Read` is safe to call concurrently, but each call must own its `[]Sample` — concurrent `Read` into the *same* slice races on the `Value` storage (and on a shared histogram's backing arrays). Two goroutines reading `shared` simultaneously interleave writes and reads of the same `Value`.

**Fix:** give each reader its own slice, or serialise access:

```go
func reader() uint64 {
    s := []metrics.Sample{{Name: "/sched/goroutines:goroutines"}} // per-goroutine
    metrics.Read(s)
    return s[0].Value.Uint64()
}
```

For a hot path, use one background sampler writing to an `atomic` value instead (see Bug 14).

---

## Bug 20 — Switching on `Description.Kind` and handling `KindBad`

```go
for _, d := range metrics.All() {
    switch d.Kind {
    case metrics.KindUint64:    registerCounter(d)
    case metrics.KindFloat64:   registerGauge(d)
    case metrics.KindBad:       log.Printf("bad metric %s", d.Name) // never happens
    }
    // histograms silently dropped!
}
```

**Bug:** Two problems. First, `Description.Kind` is *never* `KindBad` — that kind only comes from `Read` on an unknown name — so that case is dead code. Second, the switch has no `KindFloat64Histogram` case, so every histogram metric is silently dropped from the exporter. Also note: counter-vs-gauge should key off `Cumulative`, not `Kind`.

**Fix:**

```go
for _, d := range metrics.All() {
    switch {
    case d.Kind == metrics.KindFloat64Histogram:
        registerHistogram(d)
    case d.Cumulative:
        registerCounter(d)
    default:
        registerGauge(d)
    }
}
```

---

## Bug 21 — Forgetting that scalar `Value` can be `Float64`, not just `Uint64`

```go
func readUint(name string) uint64 {
    s := []metrics.Sample{{Name: name}}
    metrics.Read(s)
    return s[0].Value.Uint64() // assumes every scalar is Uint64
}

v := readUint("/gc/gogc:percent") // panics: /gc/gogc:percent is Float64
```

**Bug:** Not every scalar metric is `Uint64`. `/gc/gogc:percent` is `KindFloat64`. A `readUint` helper that always calls `Uint64()` panics on float-kind metrics.

**Fix:** branch on `Kind()`, or provide separate helpers and use the right one:

```go
func readScalar(name string) (float64, bool) {
    s := []metrics.Sample{{Name: name}}
    metrics.Read(s)
    switch s[0].Value.Kind() {
    case metrics.KindUint64:
        return float64(s[0].Value.Uint64()), true
    case metrics.KindFloat64:
        return s[0].Value.Float64(), true
    default:
        return 0, false
    }
}
```

---

## Bug 22 — Comparing two metrics read in separate `Read` calls

```go
metrics.Read([]metrics.Sample{allocs}) // call 1
metrics.Read([]metrics.Sample{frees})  // call 2
liveApprox := allocs.Value.Uint64() - frees.Value.Uint64() // inconsistent snapshot
```

**Bug:** `allocs` and `frees` are read in two separate `Read` calls, so they reflect two different instants — the runtime kept allocating and freeing in between. Their difference is not a coherent "live bytes" figure; it can even go slightly negative under churn.

**Fix:** read mutually-dependent metrics in the *same* `Read` call, which gives a coherent snapshot:

```go
s := []metrics.Sample{
    {Name: "/gc/heap/allocs:bytes"},
    {Name: "/gc/heap/frees:bytes"},
}
metrics.Read(s) // both from one consistent view
live := s[0].Value.Uint64() - s[1].Value.Uint64()
```

---

## Summary

`runtime/metrics` looks like a plain key-value read, but it has strict semantics that catch the unwary. Most bugs come from one of three habits:

1. **Ignoring the `Kind` discipline.** Reading without switching on `Kind()` panics; assuming a scalar is `Uint64` (it might be `Float64`); dropping histograms; treating `Description.Kind == KindBad` as reachable. Always branch on `Kind()`, and key counter-vs-gauge off `Cumulative`.
2. **Mishandling the data lifecycle.** Allocating the `[]Sample` per read or per request; calling `All()` every scrape; retaining a histogram across `Read` calls (it aliases reused storage); reading mutually-dependent metrics in separate calls; sharing one slice across concurrent readers. Discover once, reuse one slice per reader, copy histograms before re-reading, and read related metrics together.
3. **Misinterpreting the numbers.** Confusing cumulative ("ever") with instantaneous ("now"); plotting a counter as a gauge; not differencing cumulative histograms; treating `/memory/classes/total:bytes` as RSS; ignoring the unit suffix; diffing histograms across Go versions; and reintroducing `ReadMemStats`'s stop-the-world. Respect `Cumulative`, the unit, and the version-specific bucket layout.

Treat each `Value` as a tagged union read under a checked accessor, treat the sample slice as reusable storage the runtime writes into, and respect the self-describing name (path + unit + cumulative flag). With those habits the rest of `runtime/metrics` becomes routine.
