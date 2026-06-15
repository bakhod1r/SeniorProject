# `runtime/metrics` — Interview Questions

> Practice questions ranging from junior to staff-level. Each has a model answer, common wrong answers, and follow-up probes.

---

## Junior

### Q1. What is the `runtime/metrics` package and what does it replace?

**Model answer.** It is the standard library's supported, self-describing interface for reading Go runtime statistics — heap memory, goroutine counts, GC pauses, scheduler latency, CPU time. It supersedes `runtime.ReadMemStats`/`runtime.MemStats` and `debug.GCStats`. Metrics are named by slash-paths with a unit suffix, e.g. `/gc/heap/allocs:bytes` or `/sched/goroutines:goroutines`. You discover the available metrics at runtime with `metrics.All()` and sample them with `metrics.Read`.

**Common wrong answers.**
- "It's the same as `MemStats` with nicer names." (No — it's discoverable, extensible, and avoids stop-the-world.)
- "It profiles my program." (No — that's `pprof`. This is lightweight aggregate metrics.)
- "It lets you change GC behaviour." (No — it's read-only; tuning is `GOGC`/`GOMEMLIMIT`/`runtime/debug`.)

**Follow-up.** *Why a new package instead of extending `MemStats`?* — `MemStats` is frozen by the Go 1 compatibility promise; it cannot grow. A discoverable metric table can.

---

### Q2. How do you read a single metric value?

**Model answer.** Build a `[]metrics.Sample` with the metric name, call `metrics.Read`, then check `Value.Kind()` and call the matching accessor:

```go
s := []metrics.Sample{{Name: "/sched/goroutines:goroutines"}}
metrics.Read(s)
if s[0].Value.Kind() == metrics.KindUint64 {
    n := s[0].Value.Uint64()
}
```

**Common wrong answer.** "Just call `s[0].Value.Uint64()` directly." — That panics if the kind doesn't match. The `Kind()` check is mandatory.

**Follow-up.** *What if the name is wrong?* — `Read` sets `Kind()` to `KindBad`; no error is returned.

---

### Q3. What does a metric name like `/gc/heap/allocs:bytes` tell you?

**Model answer.** Two things. The path `/gc/heap/allocs` is *what* is measured — cumulative bytes allocated to the heap. The suffix `:bytes` is the *unit*. Split on the final colon: left is the hierarchical name, right is the unit. The `/gc/` prefix groups it with the garbage-collector family.

**Follow-up.** *Is it a counter or a gauge?* — A counter (cumulative). `Description.Cumulative` is `true` for it.

---

### Q4. What are the possible `ValueKind`s?

**Model answer.** Four: `KindUint64` (read with `Uint64()`), `KindFloat64` (read with `Float64()`), `KindFloat64Histogram` (read with `Float64Histogram()`), and `KindBad` (the metric isn't supported on this Go version — no accessor). You must switch on `Kind()` before reading, because calling the wrong accessor panics.

**Follow-up.** *What does `KindBad` mean operationally?* — Either a typo in the name, or a metric added in a newer Go version than the running binary. You skip it.

---

### Q5. Does reading metrics stop the world like `ReadMemStats`?

**Model answer.** No. Avoiding the stop-the-world pause is a primary reason the package exists. `ReadMemStats` halts every goroutine to copy a consistent snapshot; `runtime/metrics` reads from per-P counters and atomics without a global pause, so you can sample continuously in a latency-sensitive service.

**Follow-up.** *So should I still use `ReadMemStats` periodically?* — No. Migrate periodic polling to `runtime/metrics` to remove the self-inflicted pauses.

---

## Middle

### Q6. How do you read a histogram metric correctly?

**Model answer.** A `Float64Histogram` has two parallel slices: `Counts` (length N) and `Buckets` (length N+1). `Counts[i]` is the number of observations in `[Buckets[i], Buckets[i+1])`. The outer bucket edges may be `±Inf`. For cumulative histograms like `/sched/latencies:seconds`, `Counts` are lifetime totals, so a windowed distribution requires subtracting a previous snapshot bucket-by-bucket.

```go
h := s[0].Value.Float64Histogram()
for i, c := range h.Counts {
    lo, hi := h.Buckets[i], h.Buckets[i+1]
    _ = lo; _ = hi; _ = c
}
```

**Common wrong answer.** "`Buckets` and `Counts` are the same length." — No, `len(Buckets) == len(Counts)+1`.

**Follow-up.** *Why might bucket edges be infinite?* — The first and last buckets are open-ended catch-alls.

---

### Q7. What are the main metric families?

**Model answer.**
- `/gc/*` — collector: allocs/frees (bytes and objects), GC cycles, `/gc/pauses:seconds` histogram, heap goal, `GOGC`/`GOMEMLIMIT`.
- `/memory/classes/*` — a closed taxonomy of where memory went (heap objects/unused/free/released, stacks, metadata, OS), summing to `/memory/classes/total:bytes`.
- `/sched/*` — goroutine count, `/sched/latencies:seconds` histogram, `GOMAXPROCS`.
- `/cpu/*` (1.20+) — CPU-seconds split into GC, scavenge, user, idle, total.
- `/sync/mutex/wait/total:seconds` (1.18+) — mutex contention time.

**Follow-up.** *What does the `/memory/classes/*` sum-to-total property buy you?* — Closed accounting: every runtime-mapped byte lands in exactly one class, so the largest class points at where memory went.

---

### Q8. Map some `MemStats` fields to metrics.

**Model answer.**
- `HeapAlloc` → `/memory/classes/heap/objects:bytes`
- `TotalAlloc` → `/gc/heap/allocs:bytes`
- `Sys` → `/memory/classes/total:bytes`
- `NumGC` → `/gc/cycles/total:gc-cycles`
- `HeapReleased` → `/memory/classes/heap/released:bytes`
- `PauseNs[]` → `/gc/pauses:seconds` (now a full histogram, not a 256-element ring)

Most fields map cleanly; the histograms are strictly richer than the old fixed-size pause ring.

**Follow-up.** *Is `/memory/classes/total:bytes` the same as process RSS?* — No. It's the runtime's mapped memory, not the OS resident set; cgo and mmap'd files live outside it.

---

### Q9. Why allocate the `[]Sample` slice once?

**Model answer.** `metrics.Read` overwrites the `Value` fields in place; the `Name` fields stay fixed. Allocating the slice every read creates garbage on a hot path — ironic in a tool used to watch the GC. Build it once at startup and reuse it. For histograms, also remember `Read` may reuse the slice backing the histogram, so copy if you retain it.

**Follow-up.** *What's the cost model of `Read`?* — Linear in sample count; histograms are the priciest because they copy slices.

---

### Q10. How does forward-compatibility work across Go versions?

**Model answer.** The metric set is discovered at runtime via `metrics.All()`, not baked into the struct. On a newer binary, new metrics simply aren't read by old code. On an older binary, names your newer code references that don't exist read as `KindBad` rather than erroring. A robust collector intersects the metrics it wants with `All()` at startup and still tolerates `KindBad` defensively.

**Follow-up.** *Can bucket boundaries change between versions?* — Yes. Never persist a histogram from one Go version and diff it against another's.

---

### Q11. How do you decide whether to export a metric as a counter or a gauge?

**Model answer.** Branch on `Description.Cumulative`. `true` means monotonically increasing — export as a Prometheus `Counter` (and rate-difference it in queries). `false` means instantaneous — export as a `Gauge` and plot it directly. Getting this wrong is the classic dashboard bug: a cumulative counter plotted raw shows an ever-rising line.

**Follow-up.** *What about histograms?* — Cumulative histograms map to Prometheus `Histogram`; quantile interpolation happens in the query layer.

---

### Q12. What is the relationship between `runtime/metrics` and `runtime/debug`?

**Model answer.** They are read and write sides of runtime introspection. `runtime/metrics` *observes* — heap, GC, scheduler. `runtime/debug` and `GODEBUG`/`SetGCPercent`/`SetMemoryLimit` *tune* — forcing GC, setting `GOMEMLIMIT`, adjusting `GOGC`. You read `/gc/gomemlimit:bytes` and `/gc/gogc:percent` to confirm what the tuning actually is. They are designed to be used together. (See the `05-godebug-and-runtime-debug` topic.)

**Follow-up.** *Can `runtime/metrics` change GC behaviour?* — No, it is strictly read-only.

---

## Senior

### Q13. How do you export runtime metrics to Prometheus correctly?

**Model answer.** Use the standard `collectors.NewGoCollector` from `prometheus/client_golang`, which is built on `runtime/metrics`. It maps each metric to the correct Prometheus type (cumulative → `Counter` with `_total`, instantaneous → `Gauge`, cumulative histogram → `Histogram`), translates names (`/gc/heap/allocs:bytes` → `go_gc_heap_allocs_bytes_total`), and preserves native histogram buckets. Curate the exported set with `WithGoCollectorRuntimeMetrics` rule matchers rather than dumping `MetricsAll` — every series costs scrape, storage, and query across every instance.

**Common wrong answer.** "Hand-roll the mapping." — You'll get counter-vs-gauge or histogram boundaries wrong. Use the library.

**Follow-up.** *Why not re-bucket histograms into round SLO numbers?* — You lose precision; export native buckets and use `histogram_quantile` in PromQL.

---

### Q14. What does sampling cost, and how often should you sample?

**Model answer.** `Read` is cheap but not free: cost is linear in sample count, and histograms copy slices. Bound the work to the scrape — the Prometheus collector reads on demand at scrape time, so cost is `scrape_freq × exported_metrics`. Dashboards want 15–60s; high-resolution debugging tops out at a few reads per second. Never sample in a request hot path: these are process-global metrics, so per-request reads gain nothing and allocate.

**Follow-up.** *How do you keep the scalar path allocation-free?* — Reuse one `[]Sample`; scalar reads then allocate nothing.

---

### Q15. How do you handle Go version skew across a fleet?

**Model answer.** Every process discovers its own metric set via `All()`, so a 1.19 instance simply won't emit `/cpu/*` while a 1.20 one does. Dashboards and alerts must tolerate an absent series (use `or`/`clamp` in PromQL, not assertions). Build paging alerts only on the stable subset that exists on your *oldest* supported Go version; treat newer metrics as enrichment. Never diff histogram buckets across versions — boundaries can differ.

**Follow-up.** *What breaks if you assume uniformity?* — During every staged Go upgrade, some instances lack newer metrics, so an alert that asserts presence flaps or misfires.

---

### Q16. Walk through diagnosing a memory leak with these metrics.

**Model answer.** Read the whole `/memory/classes/*` family over time. If `/memory/classes/heap/objects:bytes` grows unbounded, it's a live-set leak — real references retained. If `heap/free` is high but `heap/released` is low, the scavenger isn't returning memory; check `GOMEMLIMIT` and `/cpu/classes/scavenge/total:cpu-seconds`. Cross-check `/sched/goroutines:goroutines` for a goroutine leak (each goroutine holds a stack). Metrics narrow the hypothesis cheaply; then a heap `pprof` profile confirms *which allocation site*.

**Follow-up.** *Why isn't `/memory/classes/total:bytes` enough?* — It tells you total grew, not which class; the leaf classes localise it.

---

### Q17. How do you diagnose GC-induced tail latency?

**Model answer.** Two metrics. `/gc/pauses:seconds` is the stop-the-world pause distribution — a long tail there correlates directly with request-latency tails (something `MemStats` could only approximate with its pause ring). `/cpu/classes/gc/total:cpu-seconds` as a fraction of `/cpu/classes/total:cpu-seconds` gives the GC CPU tax. High GC CPU with frequent `/gc/cycles/total` increments means allocation pressure — cut allocation rate or tune `GOGC`/`GOMEMLIMIT`.

**Follow-up.** *What confirms the allocation-pressure hypothesis?* — The rate of `/gc/heap/allocs:bytes`, then a heap profile to find the hot allocator.

---

### Q18. Why must you copy a histogram if you keep it across reads?

**Model answer.** `Read` may reuse the storage backing a `Float64Histogram`'s `Counts`/`Buckets` on the next call into the same `[]Sample`. If you retain the returned `*Float64Histogram` and read again, your retained copy mutates underneath you. To keep a snapshot — say, to compute a windowed delta — deep-copy `Counts` and `Buckets` before the next `Read`.

**Follow-up.** *Does this apply to scalar values?* — No; scalars are inline in the `Value` and safe to copy by value.

---

## Staff / Architect

### Q19. Design the runtime-observability layer for a 2,000-instance Go fleet.

**Model answer.** Curated, version-robust, layered.

**Export.** Each process registers `NewGoCollector` with a curated rule set: ~15–20 metrics that map to SLOs and the capacity model (goroutines, heap classes, GC pauses, sched latencies, CPU classes, gomemlimit/gogc). Drop the rest — at 2,000 instances, every metric is 2,000 active series, and histograms multiply.

**Cardinality.** No labels added to runtime metrics (they're global). Series budget = exported_metrics × instances; histograms dominate, so cap how many you export.

**Version skew.** Alerts only on the stable subset present on the oldest supported Go version; dashboards use `or`/`clamp` so a missing series during rollout doesn't break panels.

**Layering.** Metrics are the always-on cheap layer that fires alerts and narrows hypotheses; `pprof` (heap/CPU/mutex/block) and execution traces are on-demand, triggered by what the metrics show. Continuous profiling can run at low frequency for the heaviest services.

**Config visibility.** Export `/gc/gomemlimit:bytes` and `/gc/gogc:percent` so dashboards show the tuning each process actually runs under — catches config drift.

**Follow-up.** *How do you keep TSDB cost bounded as you scale instances?* — Curate exported metrics, prefer native histograms (sparse), and push ad-hoc full dumps to an on-demand debug endpoint, not the steady-state scrape.

---

### Q20. When would you build a custom collector instead of using `NewGoCollector`?

**Model answer.** Rarely, and only for a concrete capability the standard collector lacks: emitting to a non-Prometheus sink (custom log format, OTel-native histograms with the runtime's exact buckets), bespoke naming required by an existing dashboard contract, or selective export logic the rule matchers can't express. The custom collector must still follow the same discipline: discover via `All()` once, reuse one `[]Sample`, capture `Kind`/`Cumulative` at build time, drop unsupported names at construction, and copy histograms before re-reading. Replicating the Prometheus type/name/bucket mapping by hand is the part most likely to be wrong.

**Follow-up.** *What's the biggest correctness risk in a hand-rolled collector?* — Counter-vs-gauge selection and histogram bucket translation (infinite edges, native vs classic).

---

### Q21. Could you reconstruct everything `MemStats` gave you from `runtime/metrics`? Any gaps?

**Model answer.** Almost entirely, and more. Heap, sys, allocs/frees, GC cycles, released memory, and pause times all have metric equivalents — and the pause histogram is strictly richer than `MemStats.PauseNs[]`'s 256-element ring. A few `MemStats` fields have no direct one-to-one metric (e.g. `LastGC` timestamp) and must be derived from cycle counts plus timing. Conversely, `runtime/metrics` adds things `MemStats` never had: scheduler latency, mutex wait time, CPU-class breakdown. The migration is overwhelmingly a win; the only cost is slightly more verbose call sites.

**Follow-up.** *Why migrate at all if `MemStats` "mostly works"?* — To stop the periodic stop-the-world pause and to gain the histograms and CPU breakdown.

---

### Q22. How do `runtime/metrics`, `expvar`, and OpenTelemetry relate in a real service?

**Model answer.** They sit at different layers. `runtime/metrics` is the *source* of runtime numbers. `expvar` is a simple HTTP publication mechanism (`/debug/vars`) you can feed from `runtime/metrics` for quick introspection without a metrics backend. OpenTelemetry (and Prometheus) are the *export and aggregation* layer; their Go instrumentation can read `runtime/metrics` and ship it as OTLP/scrape series with proper types. In practice: `runtime/metrics` produces, a collector (Prometheus `GoCollector` or an OTel runtime-metrics instrumentation) maps and exports, and `expvar` is a lightweight local debug view. You don't pick one — you compose them. (See topics `02-expvar` and `04-opentelemetry-in-go`.)

**Follow-up.** *Where does `pprof` fit?* — Orthogonal: profiling for per-call-site detail, triggered by what these aggregate metrics reveal.

---

## Quick-fire

| Q | Crisp answer |
|---|--------------|
| Discover available metrics? | `metrics.All()`. |
| Sample values? | `metrics.Read([]Sample)`. |
| Check value type? | `Value.Kind()`. |
| Wrong accessor for kind? | Panics. |
| Unknown metric name? | `KindBad`, no error. |
| Histogram slice lengths? | `len(Buckets) == len(Counts)+1`. |
| Outer histogram edges? | May be `±Inf`. |
| Counter vs gauge field? | `Description.Cumulative`. |
| Stops the world? | No (unlike `ReadMemStats`). |
| Added in Go version? | 1.16 (`/cpu/*` in 1.20). |
| Export to Prometheus? | `collectors.NewGoCollector`. |
| Read-only? | Yes; tuning is `runtime/debug`/env. |

---

## Mock Interview Pacing

A 30-minute interview on `runtime/metrics` might cover:

- 0–5 min: warm-up — Q1, Q2, Q4.
- 5–15 min: middle topics — Q6, Q7, Q9, Q10.
- 15–25 min: a senior scenario — Q13, Q15, or Q16.
- 25–30 min: a curveball — Q19 or Q21.

If the candidate claims production observability experience, drive straight to Q13 (Prometheus mapping) and Q15 (version skew) — both are field-test questions. If they have only read the docs, stay in middle territory and probe whether they truly understand histograms (Q6) and the `Kind()` discipline (Q4, Q18). A staff candidate should reach Q19 within fifteen minutes and naturally connect metrics to profiling and tracing.
