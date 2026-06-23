# `runtime/metrics` — Hands-on Tasks

> Practical exercises from easy to hard. Each task says what to build, what success looks like, and a hint or expected outcome. Solutions are sketched at the end.

---

## Easy

### Task 1 — List every metric on your Go version

Write a program that prints every metric `metrics.All()` reports, with its `Kind`, `Cumulative`, and `Description`. Pipe it through `wc -l` to count how many metrics your Go version exposes.

```go
for _, d := range metrics.All() {
    fmt.Printf("%-45s %-22v cum=%-5v %s\n", d.Name, d.Kind, d.Cumulative, d.Description)
}
```

**Goal.** See the real catalogue on your exact toolchain. Note how the count differs between Go 1.19, 1.20, and 1.21+ if you have them installed.

---

### Task 2 — Read the live goroutine count

Sample `/sched/goroutines:goroutines`, check `Value.Kind() == metrics.KindUint64`, and print it. Then `go func(){ select{} }()` a few dozen idle goroutines and re-read. Confirm the count rises.

**Goal.** Read one `Uint64` metric correctly, with the `Kind()` check, and watch it change.

---

### Task 3 — Read several metrics in one call

Build a `[]metrics.Sample` of three names (`/sched/goroutines:goroutines`, `/memory/classes/heap/objects:bytes`, `/gc/cycles/total:gc-cycles`) and read them all in one `metrics.Read` call. Print each by switching on `Kind()`.

**Goal.** Internalise the batch-read model: one slice, one `Read`, branch on kind.

---

### Task 4 — Trigger and observe `KindBad`

Add a deliberately bogus name (`/does/not/exist:bytes`) to your sample slice. Call `Read`. Confirm that sample's `Kind()` is `KindBad` and that no error or panic occurred. Then try calling `.Uint64()` on it and observe the panic.

**Goal.** Understand that unknown names are silent (`KindBad`), and that the wrong accessor panics.

---

### Task 5 — Counter vs gauge

For each metric in `metrics.All()`, print whether it is `Cumulative`. Pick one counter (`/gc/heap/allocs:bytes`) and one gauge (`/sched/goroutines:goroutines`). Sample each twice with a workload in between, and observe that the counter only rises while the gauge can go up or down.

**Goal.** Distinguish counters from gauges and see why you'd treat them differently on a dashboard.

---

## Medium

### Task 6 — Read a GC pause histogram

Allocate aggressively (e.g. build and discard large slices in a loop) to force several GCs, then read `/gc/pauses:seconds`. Iterate `Counts`/`Buckets`, print each non-empty bucket's range and count, and the total number of pauses recorded.

Remember `len(Buckets) == len(Counts)+1` and that outer edges may be `±Inf`.

**Goal.** Read a `Float64Histogram` correctly, handling the N+1 rule and infinite edges.

---

### Task 7 — Approximate a p99 from a histogram

Extend Task 6. Compute an approximate p99 GC pause by walking the cumulative `Counts` until you reach 99% of the total, and return the upper bucket edge. Compare it against the max bucket that has any count.

**Goal.** Turn a histogram into a percentile estimate and understand its quantisation limits.

---

### Task 8 — Verify the memory-classes sum

Read every `/memory/classes/*` leaf and `/memory/classes/total:bytes`. Sum the leaves and confirm they equal the total (within the set you read). If they don't, you've missed a class — find it via `metrics.All()`.

**Goal.** Prove the closed-accounting property of the memory taxonomy.

---

### Task 9 — Map `MemStats` to metrics, side by side

Write a program that reads both `runtime.ReadMemStats(&ms)` and the metric equivalents (`/memory/classes/heap/objects:bytes` for `HeapAlloc`, `/gc/heap/allocs:bytes` for `TotalAlloc`, `/gc/cycles/total:gc-cycles` for `NumGC`). Print them side by side and confirm they agree.

**Goal.** Build confidence in the `MemStats`→metrics mapping before migrating real code.

---

### Task 10 — A periodic runtime logger with slice reuse

Write a logger that, every 2 seconds, prints goroutines, live heap bytes, and total GC cycles. Allocate the `[]Sample` **once** outside the loop and reuse it. Then deliberately move the allocation inside the loop, run under `go run -gcflags=-m` or a quick benchmark, and observe the extra garbage.

**Goal.** Internalise slice reuse and why allocating per read is wrong in a metrics path.

---

### Task 11 — CPU-class breakdown (Go 1.20+)

Read `/cpu/classes/gc/total:cpu-seconds`, `/cpu/classes/scavenge/total:cpu-seconds`, `/cpu/classes/user:cpu-seconds`, and `/cpu/classes/total:cpu-seconds`. Run a GC-heavy workload and compute the GC CPU fraction (`gc/total ÷ total`). Guard for `KindBad` so the program still runs on Go 1.19.

**Goal.** Compute the GC CPU tax and write version-robust code.

---

## Hard

### Task 12 — A reusable, version-robust collector

Build a `Collector` type that:
1. Takes a list of wanted metric names.
2. Validates them against `metrics.All()` at construction, dropping unsupported ones.
3. Stores `Kind` and `Cumulative` per metric.
4. Reuses one `[]Sample` across reads.
5. Exposes `Read()` that returns typed results.

Run it across two Go versions (e.g. 1.19 and 1.21) and confirm it silently drops `/cpu/*` on the older one.

**Goal.** Build the production-shaped collector underneath `NewGoCollector`.

---

### Task 13 — Windowed histogram delta

Snapshot `/sched/latencies:seconds`, wait 10 seconds under load, snapshot again. Compute the per-bucket delta (`cur.Counts[i] - prev.Counts[i]`) to get the *scheduling latency distribution over that window*. Deep-copy the first snapshot's slices before the second `Read` so it isn't mutated.

**Goal.** Difference cumulative histograms correctly, and learn why you must copy before re-reading.

---

### Task 14 — Export to Prometheus with curation

Stand up an HTTP server with `prometheus/client_golang`. Register `collectors.NewGoCollector` with a curated rule set that exports only `/sched/*` and `/gc/*`. Scrape `/metrics` and confirm the runtime series appear with correct names (`go_gc_..._total` for counters) and that other families are absent.

**Goal.** Export runtime metrics the supported way, with curation, and verify the counter/gauge naming.

---

### Task 15 — Prove hermetic, low-overhead sampling

Write a benchmark (`testing.B`) that calls `Read` on a reused 10-element scalar sample slice in a loop. Confirm with `-benchmem` that steady-state allocations per op are zero. Then add a histogram metric to the slice and observe the allocation appear.

**Goal.** Measure the cost model: scalars are alloc-free with reuse; histograms allocate.

---

### Task 16 — A `/debug/metrics` JSON endpoint

Build an HTTP handler that dumps *every* metric as JSON: name, kind, and value (scalars as numbers, histograms as `{counts, buckets}`). Use it as an on-demand debug endpoint — not a steady-state scrape. Gate it behind a non-public bind address.

**Goal.** Build a full-dump introspection endpoint and understand why it's debug-only, not for scraping.

---

### Task 17 — Memory-leak hunt with metrics

Write a program with a deliberate leak (append to a package-level slice in a handler, never trim). Drive load and watch `/memory/classes/heap/objects:bytes` climb while `/gc/cycles/total` keeps ticking but memory never drops. Then watch `/sched/goroutines:goroutines` for a separate goroutine leak. Use the metrics to *localise* before reaching for `pprof`.

**Goal.** Use the metric families as a first-line leak diagnosis, the way you would in production.

---

## Bonus / Stretch

### Task 18 — Compare GC tuning via `/gc/gomemlimit` and `/gc/gogc`

On Go 1.21+, set `GOMEMLIMIT` and `GOGC` via `runtime/debug.SetMemoryLimit`/`SetGCPercent`, then read `/gc/gomemlimit:bytes` and `/gc/gogc:percent` to confirm the runtime reflects them. Vary the limit and watch `/cpu/classes/gc/total:cpu-seconds` rise as the limit tightens.

**Goal.** Connect the read-side (`runtime/metrics`) to the write-side (`runtime/debug`); see the GC-pressure signature of a too-tight limit. Cross-reference [05-godebug-and-runtime-debug](../05-godebug-and-runtime-debug/senior.md).

---

### Task 19 — Mutex-contention detector

Build a program with intentional `sync.Mutex` contention (many goroutines hammering one lock). Sample `/sync/mutex/wait/total:seconds` over time and compute its rate. Confirm the rate spikes under contention and is near-zero when serialised. Use it as a cheap trigger before reaching for a mutex profile.

**Goal.** Use the always-on contention metric to decide *when* to run the expensive mutex profiler.

---

### Task 20 — Decide whether to export the full set

For a real service, register `NewGoCollector` once with `MetricsAll` and once with a curated rule set. Count the resulting series in each (`curl /metrics | grep '^go_' | wc -l`). Multiply by a hypothetical instance count (say 2,000). Write a one-paragraph recommendation on which set to export and why, considering TSDB cost and what you actually alert on.

**Goal.** Make export curation a deliberate, cardinality-aware decision rather than a default.

---

## Solutions (sketched)

### Solution 1
```go
for _, d := range metrics.All() {
    fmt.Printf("%-45s %-22v %v  %s\n", d.Name, d.Kind, d.Cumulative, d.Description)
}
```
Count varies by version; 1.21+ adds `/cpu/*`, `/gc/gogc`, `/gc/gomemlimit`, `/sched/gomaxprocs`, `/godebug/*`.

### Solution 2
```go
s := []metrics.Sample{{Name: "/sched/goroutines:goroutines"}}
metrics.Read(s)
fmt.Println(s[0].Value.Uint64())
```
Spawning idle goroutines raises the count; it's a gauge.

### Solution 3
Build a 3-element slice, one `Read`, `switch s[i].Value.Kind()` and print with the matching accessor.

### Solution 4
`KindBad` is returned silently; `Uint64()` on it panics. The lesson: always branch on `Kind()`.

### Solution 5
`/gc/heap/allocs:bytes` is cumulative (only rises); `/sched/goroutines:goroutines` is not (rises and falls). Branch on `Description.Cumulative`.

### Solution 6
```go
h := s[0].Value.Float64Histogram()
var total uint64
for i, c := range h.Counts {
    if c == 0 { continue }
    fmt.Printf("[%.6g, %.6g) : %d\n", h.Buckets[i], h.Buckets[i+1], c)
    total += c
}
```
Handle `math.Inf` edges when formatting.

### Solution 7
Sum all counts → total. Walk cumulatively until `cum >= 0.99*total`; return `Buckets[i+1]`. It's an upper-bound estimate; bucket width caps precision.

### Solution 8
Sum the leaves; they equal `/memory/classes/total:bytes`. A mismatch means you omitted a class — list `All()` and find the missing `/memory/classes/*` leaf.

### Solution 9
`ms.HeapAlloc ≈ heap/objects:bytes`, `ms.TotalAlloc == /gc/heap/allocs:bytes`, `ms.NumGC == /gc/cycles/total:gc-cycles`. Minor timing differences between the two reads are expected.

### Solution 10
Hoist `samples := []metrics.Sample{...}` out of the loop. Inside-the-loop allocation shows up as per-iteration garbage; reuse keeps the scalar path alloc-free.

### Solution 11
```go
gc := frac("/cpu/classes/gc/total:cpu-seconds", "/cpu/classes/total:cpu-seconds")
```
Guard each with a `KindBad` check so 1.19 doesn't crash.

### Solution 12
Discover via `All()` once into a map; for each wanted name present, append a `Sample` and record `Kind`/`Cumulative`. `Read()` reuses the slice. On 1.19, `/cpu/*` names are absent from `All()` and get dropped at construction.

### Solution 13
Deep-copy `prev.Counts`/`prev.Buckets` before the second `Read` (which may reuse storage). Subtract element-wise; identical `Buckets` make the subtraction valid.

### Solution 14
```go
reg.MustRegister(collectors.NewGoCollector(
    collectors.WithGoCollectorRuntimeMetrics(
        collectors.GoRuntimeMetricsRule{Matcher: regexp.MustCompile(`^/(sched|gc)/.*`)},
    ),
))
```
Counters export with a `_total` suffix; only `/sched/*` and `/gc/*` series appear.

### Solution 15
With a reused scalar slice, `-benchmem` shows `0 allocs/op`. Adding a histogram metric makes the per-op allocation appear (slice copy).

### Solution 16
Iterate `All()`, build a sample per name, `Read`, and JSON-encode by kind. Bind to `127.0.0.1` or behind auth; it's a debug dump, not a scrape target.

### Solution 17
`heap/objects:bytes` climbs and never recovers despite GC cycles → live-set leak. Rising `goroutines` → goroutine leak. Metrics localise the *kind* of leak; `pprof` finds the *site*.

### Solution 18
`SetMemoryLimit`/`SetGCPercent` then read `/gc/gomemlimit:bytes` and `/gc/gogc:percent` — they reflect the active values. A tighter limit raises GC CPU (`/cpu/classes/gc/total`).

### Solution 19
`/sync/mutex/wait/total:seconds` rate spikes under contention, near-zero when serialised. Use the rate as a trigger to run a mutex profile only when it matters.

### Solution 20
`MetricsAll` can be dozens of series × 2,000 instances; a curated ~15-metric set is an order of magnitude smaller. Recommend curating to what you alert on; push full dumps to a debug endpoint.

---

## Checkpoints

After the easy tasks: you can list, read scalars, batch-read, handle `KindBad`, and distinguish counters from gauges.
After the medium tasks: you can read histograms (N+1, infinite edges), estimate percentiles, verify the memory-class sum, map `MemStats`, and reuse the sample slice.
After the hard tasks: you can build a version-robust collector, difference histograms, export to Prometheus with curation, prove the cost model, and run a leak hunt with metrics.
After the bonus tasks: you can connect read-side metrics to write-side tuning, use contention metrics as profiler triggers, and make export curation a cardinality-aware decision.
