# `runtime/metrics` — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Pros & Cons](#pros-cons)
8. [Use Cases](#use-cases)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Product Use / Feature](#product-use-feature)
13. [Error Handling](#error-handling)
14. [Security Considerations](#security-considerations)
15. [Performance Tips](#performance-tips)
16. [Best Practices](#best-practices)
17. [Edge Cases & Pitfalls](#edge-cases-pitfalls)
18. [Common Mistakes](#common-mistakes)
19. [Common Misconceptions](#common-misconceptions)
20. [Tricky Points](#tricky-points)
21. [Test](#test)
22. [Tricky Questions](#tricky-questions)
23. [Cheat Sheet](#cheat-sheet)
24. [Self-Assessment Checklist](#self-assessment-checklist)
25. [Summary](#summary)
26. [What You Can Build](#what-you-can-build)
27. [Further Reading](#further-reading)
28. [Related Topics](#related-topics)
29. [Diagrams & Visual Aids](#diagrams-visual-aids)

---

## Introduction
> Focus: "What is `runtime/metrics`?" and "How do I read a number about my running Go program?"

Every Go program shares the same runtime: a garbage collector, a scheduler, a memory allocator, OS threads. Sooner or later you want to *see* what they are doing — how much memory is in the heap, how many goroutines exist, how long GC pauses last. The `runtime/metrics` package is the official, supported way to ask.

For years the answer was `runtime.ReadMemStats`, which fills a big `runtime.MemStats` struct. That struct is frozen for backward compatibility — fields can never be added or renamed — and reading it stops every goroutine in the program for the duration of the call. `runtime/metrics`, added in Go 1.16, is the modern replacement: a *self-describing* set of named metrics that the runtime can grow over releases, read cheaply, and document at runtime.

```go
import "runtime/metrics"

descs := metrics.All() // every metric this Go version exposes
```

Each metric has a name that looks like a file path with a unit suffix:

```
/gc/heap/allocs:bytes
/memory/classes/heap/objects:bytes
/sched/goroutines:goroutines
/sched/latencies:seconds
```

The part before the colon is *what* is measured; the part after the colon is the *unit*. You discover the names at runtime, then read their current values in one batch call.

After reading this file you will:
- Understand why `runtime/metrics` exists and what it replaces
- Read the name and unit out of a metric path
- List every metric with `metrics.All()`
- Sample a metric's value with `metrics.Read`
- Tell apart a `Uint64`, a `Float64`, and a `Float64Histogram` value
- Read a histogram metric like GC pause times

You do **not** need to understand Prometheus exporters, sampling cadence, or collector design yet. This file is about the moment you say "I want to read one number about my running program, the supported way."

---

## Prerequisites

- **Required:** A working Go installation, version 1.16 or newer. `runtime/metrics` was added in 1.16; many metrics in this guide (the `/cpu/*` family, `/sync/mutex/wait/total:seconds`) need 1.19–1.20+. Check with `go version`. Examples target Go 1.21+.
- **Required:** Comfort writing and running a `main` package with `go run`.
- **Required:** Basic understanding of slices and structs — `metrics.Read` takes a `[]metrics.Sample`.
- **Helpful:** A rough idea of what a garbage collector and goroutines are. See the runtime and GC topics in section 13.
- **Helpful:** Familiarity with `runtime.ReadMemStats`, so you can appreciate what improved.

If `go version` prints `go version go1.16` or higher, you are ready; `go1.21`+ unlocks every example here.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Metric** | One named, runtime-observable quantity, e.g. the number of live goroutines. |
| **Metric name (path)** | The slash-and-colon identifier, e.g. `/sched/goroutines:goroutines`. Path before the colon, unit after. |
| **Unit suffix** | The text after the `:` in a name — `bytes`, `seconds`, `goroutines`, `objects`, `cpu-seconds`, etc. |
| **`metrics.Description`** | A struct describing one metric: `Name`, `Description`, `Kind`, `Cumulative`. Returned by `metrics.All()`. |
| **`metrics.Sample`** | A `{Name string; Value Value}` pair you fill in to request a reading. |
| **`metrics.Value`** | The opaque holder for a sampled value; you call `.Kind()` then the matching accessor. |
| **`metrics.Read`** | The function that fills the `Value` of each `Sample` you pass it. |
| **`Kind`** | What shape a value has: `KindUint64`, `KindFloat64`, `KindFloat64Histogram`, or `KindBad`. |
| **`Float64Histogram`** | A bucketed distribution: `Counts []uint64` and `Buckets []float64` (bucket boundaries). |
| **Cumulative** | A metric that only ever increases (a counter), e.g. total bytes ever allocated. Marked by `Description.Cumulative`. |
| **`MemStats`** | The older, frozen `runtime.MemStats` struct read by `runtime.ReadMemStats`. The thing `runtime/metrics` supersedes. |

---

## Core Concepts

### What `runtime/metrics` actually is

It is a small, read-only window into the Go runtime. You do not configure it, register anything, or start a collector. The runtime continuously tracks these numbers internally; the package lets you snapshot them on demand. Three pieces make up the whole API surface a junior needs:

1. `metrics.All()` — returns `[]metrics.Description`, one entry per metric this Go binary supports.
2. `metrics.Read(samples []metrics.Sample)` — fills in current values for the metrics you name.
3. The `Value` type and its `Kind()` — so you can read the number back out in the right shape.

That is the entire foundation. Everything else is naming conventions and which metrics exist.

### Metric names are self-describing paths

A name like `/gc/heap/allocs:bytes` reads left to right:

- `/gc/heap/allocs` — the *what*: cumulative bytes allocated to the heap.
- `:bytes` — the *unit*.

The path groups related metrics. Everything under `/gc/` is garbage-collector related, everything under `/memory/classes/` describes a memory category, everything under `/sched/` is scheduler related. You will recognise families at a glance once you have seen a few.

### Discover first, then read

Unlike `MemStats`, where the fields are baked into your source code at compile time, `runtime/metrics` is discovered at runtime. You ask `metrics.All()` what exists, then read what you want. This is the key design choice: new Go versions can add metrics without breaking your code, and old code keeps working because it only reads names it explicitly asked for.

### A `Value` has a `Kind`

When you read a metric, you get a `metrics.Value`. You cannot just treat it as a number — you must first ask its `Kind()`:

```go
switch v.Kind() {
case metrics.KindUint64:
    fmt.Println(v.Uint64())
case metrics.KindFloat64:
    fmt.Println(v.Float64())
case metrics.KindFloat64Histogram:
    h := v.Float64Histogram()
    // h.Counts and h.Buckets
case metrics.KindBad:
    // this metric does not exist in this Go version
}
```

Calling `v.Uint64()` on a value that is actually a histogram panics. So the `Kind()` check is not optional ceremony — it is how you read safely.

### `KindBad` means "not here"

If you put a name in a `Sample` that this Go version does not support — maybe a metric added in a later release, or a typo — `metrics.Read` does not error. It sets that sample's `Value.Kind()` to `KindBad`. Your code is expected to check for `KindBad` and skip the metric. This is how forward-compatibility works: a metric you do not have simply reads as `Bad` instead of crashing.

### Counters vs. gauges (cumulative or not)

Some metrics only go up — total GC cycles, total bytes ever allocated. The `Description.Cumulative` field is `true` for those; they behave like counters. Others go up and down — current goroutine count, current heap size in use. Those have `Cumulative == false`; they are gauges, a snapshot of "right now." Knowing which is which matters the moment you graph them: you rate-difference a counter, you plot a gauge directly.

---

## Real-World Analogies

**1. A car dashboard.** `MemStats` is a fixed dashboard from 1995 — the same six dials forever, and reading them requires turning off the engine for a second. `runtime/metrics` is a modern digital dashboard: it can show new readouts in newer cars, each readout is labelled with its unit, and glancing at it does not stall the engine.

**2. A library card catalogue.** `metrics.All()` is the catalogue: every "book" (metric) the library holds, with a short description. You browse the catalogue, pick the ones you want, then `metrics.Read` fetches exactly those off the shelf.

**3. A restaurant menu with prices and units.** Each menu line is `name : unit` — "Soup : bowl", "Steak : grams". You do not have to guess what you are getting or in what quantity; the menu tells you. `runtime/metrics` names tell you both the thing and its unit, every time.

**4. A weather station log.** Some readings are running totals (total rainfall this year — only goes up: cumulative). Others are instantaneous (current temperature — up and down: a gauge). A histogram metric is like an hourly distribution of wind speeds binned into ranges.

---

## Mental Models

### Model 1 — Names are paths, units are suffixes

Read every metric as `path:unit`. Split on the last `:`. The left half is hierarchical and groups by subsystem; the right half tells you how to interpret the number.

### Model 2 — Discover, then sample

Two phases. First `metrics.All()` tells you what exists (do this once at startup). Then `metrics.Read` samples the ones you chose (do this repeatedly). Never hard-code the assumption that a metric exists; ask, or check `KindBad`.

### Model 3 — The runtime always tracks; you only snapshot

The numbers are being updated continuously by the GC, scheduler, and allocator regardless of whether you read them. `metrics.Read` is a cheap snapshot, not a measurement that costs the runtime extra work to produce.

### Model 4 — `Value` is a tagged union

A `Value` carries both a kind tag and the data. You inspect the tag with `Kind()`, then pull the data with the matching accessor (`Uint64`, `Float64`, `Float64Histogram`). Using the wrong accessor panics. Treat it exactly like a Go type switch.

### Model 5 — A histogram is two parallel slices

```
Counts:  [ 3,  10,  42,  8 ]      ← how many observations fell in each bucket
Buckets: [b0, b1, b2, b3, b4]     ← bucket boundaries (one more than Counts)
```

`Counts[i]` is the number of observations in the half-open range `[Buckets[i], Buckets[i+1])`. There is always exactly one more boundary than there are counts.

---

## Pros & Cons

### Pros

- **Self-describing.** Names carry units; `All()` carries descriptions. No external documentation needed to know what a metric means.
- **Forward-compatible.** New metrics appear in new Go versions; your old code keeps working and simply sees `KindBad` for names it does not recognise.
- **Cheap to read.** Most metrics do **not** stop the world, unlike `runtime.ReadMemStats`.
- **Richer than MemStats.** Histograms (GC pauses, scheduler latencies) and CPU-time breakdowns that `MemStats` never exposed.
- **One batch call.** `metrics.Read` fills many samples at once, consistently.
- **Officially supported.** Part of the standard library with a documented stability policy.

### Cons

- **More verbose for one number.** Reading a single value is a few lines (build a `Sample`, `Read`, switch on `Kind`) versus one struct field with `MemStats`.
- **You must handle `Kind`.** Forgetting the `Kind()` check leads to panics.
- **Metric set varies by version.** A name in the docs may not exist in an older Go binary.
- **Histograms take getting used to.** Reading `Counts`/`Buckets` correctly (open first/last buckets, off-by-one) has a learning curve.
- **No labels.** These are global process metrics; there is no per-request or per-endpoint dimension.

For anything beyond a one-off `MemStats` field read, the tradeoff favours `runtime/metrics`.

---

## Use Cases

Reach for `runtime/metrics` when:

- **You expose a `/metrics` endpoint** and want accurate Go runtime numbers (the standard Prometheus client uses this package internally).
- **You log periodic runtime health** — goroutine count, heap in use, GC frequency — in a long-running service.
- **You want GC pause distributions**, not just an average, to diagnose latency.
- **You need scheduler latency** (`/sched/latencies:seconds`) to see whether goroutines are waiting to run.
- **You track CPU time by category** (GC vs. user vs. scavenge) with the `/cpu/*` family.
- **You are migrating off `MemStats`** to avoid its stop-the-world cost.

You might **not** need it directly when:

- You already use a metrics library (Prometheus `client_golang`, OpenTelemetry) that wraps it — let the wrapper read it.
- You only need one quick number during local debugging — `runtime.NumGoroutine()` or a one-off `MemStats` read is faster to type.

---

## Code Examples

### Example 1 — List every available metric

```go
package main

import (
    "fmt"
    "runtime/metrics"
)

func main() {
    for _, d := range metrics.All() {
        fmt.Printf("%-45s cumulative=%-5v  %s\n",
            d.Name, d.Cumulative, d.Description)
    }
}
```

Run it. You will see dozens of lines like:

```
/gc/heap/allocs:bytes                         cumulative=true   Cumulative sum of memory allocated ...
/memory/classes/heap/objects:bytes            cumulative=false  Memory occupied by live objects ...
/sched/goroutines:goroutines                  cumulative=false  Count of live goroutines.
/sched/latencies:seconds                      cumulative=true   Distribution of the time goroutines ...
```

This is the catalogue. Everything you can read is in this list, on this exact Go version.

### Example 2 — Read a single Uint64 metric

```go
package main

import (
    "fmt"
    "runtime/metrics"
)

func main() {
    const name = "/sched/goroutines:goroutines"

    samples := []metrics.Sample{{Name: name}}
    metrics.Read(samples)

    s := samples[0]
    if s.Value.Kind() == metrics.KindUint64 {
        fmt.Printf("live goroutines: %d\n", s.Value.Uint64())
    }
}
```

You build a one-element slice of `Sample`, set its `Name`, call `Read`, then read the value back after checking the `Kind`.

### Example 3 — Read several metrics at once

```go
package main

import (
    "fmt"
    "runtime/metrics"
)

func main() {
    names := []string{
        "/sched/goroutines:goroutines",
        "/memory/classes/heap/objects:bytes",
        "/gc/heap/allocs:bytes",
    }

    samples := make([]metrics.Sample, len(names))
    for i, n := range names {
        samples[i].Name = n
    }
    metrics.Read(samples)

    for _, s := range samples {
        switch s.Value.Kind() {
        case metrics.KindUint64:
            fmt.Printf("%-45s = %d\n", s.Name, s.Value.Uint64())
        case metrics.KindFloat64:
            fmt.Printf("%-45s = %f\n", s.Name, s.Value.Float64())
        case metrics.KindBad:
            fmt.Printf("%-45s = (not supported here)\n", s.Name)
        }
    }
}
```

One `Read` call fills all three. This is the normal way to sample: name what you want, read once.

### Example 4 — Read a histogram (GC pauses)

```go
package main

import (
    "fmt"
    "runtime/metrics"
)

func main() {
    const name = "/gc/pauses:seconds"

    samples := []metrics.Sample{{Name: name}}
    metrics.Read(samples)

    if samples[0].Value.Kind() != metrics.KindFloat64Histogram {
        fmt.Println("not a histogram on this Go version")
        return
    }

    h := samples[0].Value.Float64Histogram()
    var total uint64
    for i, c := range h.Counts {
        if c == 0 {
            continue
        }
        lo, hi := h.Buckets[i], h.Buckets[i+1]
        fmt.Printf("[%.6f, %.6f) : %d\n", lo, hi, c)
        total += c
    }
    fmt.Printf("total GC pauses recorded: %d\n", total)
}
```

`Counts` and `Buckets` are parallel slices, with `len(Buckets) == len(Counts)+1`. Each non-empty bucket prints its range and how many pauses fell into it.

### Example 5 — A periodic runtime logger

```go
package main

import (
    "log"
    "runtime/metrics"
    "time"
)

func main() {
    samples := []metrics.Sample{
        {Name: "/sched/goroutines:goroutines"},
        {Name: "/memory/classes/heap/objects:bytes"},
        {Name: "/gc/cycles/total:gc-cycles"},
    }

    for range time.Tick(2 * time.Second) {
        metrics.Read(samples)
        log.Printf("goroutines=%d heap_objects=%dB gc_cycles=%d",
            samples[0].Value.Uint64(),
            samples[1].Value.Uint64(),
            samples[2].Value.Uint64(),
        )
    }
}
```

Notice the slice is built **once**, outside the loop, and reused on every tick. Re-allocating it each time would be wasteful — more on that in performance.

### Example 6 — Comparing against `MemStats`

```go
package main

import (
    "fmt"
    "runtime"
    "runtime/metrics"
)

func main() {
    // Old way: stops the world.
    var ms runtime.MemStats
    runtime.ReadMemStats(&ms)
    fmt.Println("MemStats HeapAlloc:", ms.HeapAlloc)

    // New way: does not stop the world.
    s := []metrics.Sample{{Name: "/memory/classes/heap/objects:bytes"}}
    metrics.Read(s)
    fmt.Println("metrics heap/objects:", s[0].Value.Uint64())
}
```

Both report live heap memory; only the first one pauses every goroutine to do it.

---

## Coding Patterns

### Pattern: build the sample slice once, read many times

```go
var samples = []metrics.Sample{
    {Name: "/sched/goroutines:goroutines"},
    {Name: "/memory/classes/heap/objects:bytes"},
}

func snapshot() {
    metrics.Read(samples) // reuse the same slice
}
```

The `Name` fields stay fixed; only the `Value` fields are overwritten on each `Read`. Allocate the slice at startup.

### Pattern: validate names against `All()` at startup

```go
supported := map[string]bool{}
for _, d := range metrics.All() {
    supported[d.Name] = true
}
if !supported["/sched/latencies:seconds"] {
    log.Println("scheduler latency metric not available on this Go version")
}
```

Check once, fail loud, and you never have to guess at runtime.

### Pattern: a helper to fetch one Uint64

```go
func readUint(name string) (uint64, bool) {
    s := []metrics.Sample{{Name: name}}
    metrics.Read(s)
    if s[0].Value.Kind() != metrics.KindUint64 {
        return 0, false
    }
    return s[0].Value.Uint64(), true
}
```

Fine for occasional reads; for hot paths, reuse a shared slice instead of allocating per call.

---

## Clean Code

- **Name your metric paths as constants.** `const goroutinesMetric = "/sched/goroutines:goroutines"`. Typos become `KindBad` at runtime, which is silent — a constant catches the typo at the call site.
- **Always switch on `Kind()` before reading.** Never call `Uint64()` without first confirming `KindUint64`.
- **Handle `KindBad` explicitly.** Even if "the metric obviously exists," code defensively for older Go versions.
- **Allocate the `[]Sample` once.** Reusing it is both faster and clearer about intent (these are the metrics this component watches).
- **Keep unit awareness in the variable name.** `heapBytes`, `pauseSeconds` — the unit suffix tells you, so reflect it.

---

## Product Use / Feature

When you ship a Go service, `runtime/metrics` shows up in several places:

- **The `/metrics` HTTP endpoint.** Prometheus's `client_golang` ships a Go-runtime collector built directly on `runtime/metrics`. Scrapers get accurate heap, GC, and scheduler numbers for free.
- **Health and readiness diagnostics.** A goroutine count that climbs without bound is an early leak signal you can surface on a status page.
- **Latency investigations.** GC pause and scheduler-latency histograms let you correlate request tail latency with runtime stalls.
- **Capacity planning.** `/memory/classes/*` shows exactly where memory goes (heap, stacks, OS-reserved), which feeds resource limits and autoscaling.

For most teams the package is consumed *through* a metrics library rather than directly — but understanding it directly is what lets you read those dashboards correctly.

---

## Error Handling

`runtime/metrics` is deliberately error-free in the usual Go sense — `metrics.Read` returns nothing and never panics for unknown names. The "errors" surface as states you must check.

### `KindBad` — the metric is not supported

```go
metrics.Read(samples)
if samples[0].Value.Kind() == metrics.KindBad {
    // Either a typo, or a metric added in a newer Go version.
    log.Printf("metric %q unavailable", samples[0].Name)
}
```

This is the most common "error." It is not raised; you must look for it.

### Panic from the wrong accessor

```go
v := samples[0].Value
_ = v.Float64() // PANICS if v.Kind() is KindUint64 or KindFloat64Histogram
```

The fix is never `recover` — it is to always switch on `Kind()` first. A wrong accessor is a programming bug, not a runtime condition.

### Empty or nil samples

`metrics.Read(nil)` is a no-op. `metrics.Read` with an empty slice does nothing. Neither errors; both simply read zero metrics.

### A histogram with all-zero counts

A valid histogram can have every `Count == 0` early in a program's life (no GC has happened yet). That is not an error — iterate and you simply find nothing. Handle it as "no data yet," not as a failure.

---

## Security Considerations

- **No secrets here.** These are process-internal runtime numbers — heap size, goroutine count, GC timing. None of them are credentials.
- **But they leak operational shape.** Goroutine counts and memory sizes can hint at load patterns or concurrency design. Do not expose a raw `/metrics` endpoint to the public internet; gate it behind auth or an internal network, as you would any metrics endpoint.
- **Reading is read-only.** `runtime/metrics` cannot change runtime behaviour. It only observes. (Tuning the GC is a separate API — see [05-godebug-and-runtime-debug](../05-godebug-and-runtime-debug/junior.md).)
- **No untrusted input.** Metric names come from your own code, not from users. There is no injection surface.

---

## Performance Tips

- **Reuse the `[]Sample` slice.** Allocate it once; `Read` overwrites only the `Value` fields. Allocating per read creates needless garbage — ironic in a tool you use to watch the GC.
- **Read only the metrics you need.** `metrics.Read` cost scales with how many samples you pass. Do not pass the whole `All()` list every tick if you only graph five values.
- **Most metrics do not stop the world.** Unlike `ReadMemStats`, sampling is cheap. The notable exception historically was metrics that required a full snapshot; the package is designed to avoid that wherever possible.
- **Sample on a sensible cadence.** Once every few seconds is plenty for dashboards. Reading thousands of times per second buys you nothing and adds overhead.
- **Histograms are the priciest.** Copying `Counts`/`Buckets` allocates; read them only when you actually consume the distribution.

---

## Best Practices

1. **Discover with `All()` once at startup**, then read named metrics repeatedly.
2. **Store metric names as constants**, not inline string literals.
3. **Always check `Kind()` before reading a value.**
4. **Handle `KindBad`** for forward/backward compatibility across Go versions.
5. **Reuse one `[]Sample`** slice per collector; do not allocate per read.
6. **Prefer `runtime/metrics` over `runtime.ReadMemStats`** for anything periodic — it avoids stop-the-world.
7. **Respect the unit suffix.** A `:bytes` value is bytes; a `:seconds` value is seconds. Convert at display time, not by guessing.
8. **Let your metrics library read it** if you already have one (Prometheus, OTel); only read directly when you need something the library does not expose.

---

## Edge Cases & Pitfalls

### Pitfall 1 — Calling the wrong accessor

`v.Uint64()` on a histogram value panics. Always `switch v.Kind()` first. This is the single most common beginner crash.

### Pitfall 2 — Assuming a metric exists

`/sync/mutex/wait/total:seconds` needs Go 1.18+; the `/cpu/*` family needs 1.20+. On older binaries those names read as `KindBad`. Never assume; check.

### Pitfall 3 — Mis-reading histogram buckets

`len(Buckets) == len(Counts) + 1`. `Counts[i]` covers `[Buckets[i], Buckets[i+1])`. Indexing `Buckets` with a `Counts` index and forgetting the `+1` is an off-by-one waiting to happen.

### Pitfall 4 — The open first and last buckets

The first bucket's lower bound may be `-Inf` and the last bucket's upper bound may be `+Inf` (printed as `math.Inf`). Code that formats bucket ranges must handle infinities gracefully, or it prints nonsense.

### Pitfall 5 — Treating a counter like a gauge

`/gc/heap/allocs:bytes` is cumulative — it only grows. Plotting it raw shows an ever-rising line. To get "allocation rate," you must difference consecutive readings. Check `Description.Cumulative`.

### Pitfall 6 — Allocating samples in a hot loop

Building `[]metrics.Sample{{Name: ...}}` inside a per-tick loop allocates every iteration. Hoist it out.

### Pitfall 7 — Confusing heap "allocated ever" with heap "in use now"

`/gc/heap/allocs:bytes` (cumulative, ever) is not `/memory/classes/heap/objects:bytes` (live, now). They answer different questions. Mixing them produces wrong dashboards.

### Pitfall 8 — Expecting labels or dimensions

There is no per-endpoint or per-tenant split. These are whole-process metrics. If you need dimensions, that is your application's job, layered on top.

---

## Common Mistakes

- **Skipping the `Kind()` check** and panicking on the wrong accessor.
- **Hard-coding that a metric exists** instead of checking `All()` or `KindBad`.
- **Re-allocating the `[]Sample` slice** on every read.
- **Plotting a cumulative counter raw** instead of rate-differencing it.
- **Reading `MemStats` periodically** when `runtime/metrics` would avoid the stop-the-world cost.
- **Misinterpreting units** — treating a `:seconds` value as milliseconds, or `:bytes` as KB.
- **Off-by-one on histogram buckets** (`Buckets` has one more element than `Counts`).
- **Exposing the metrics endpoint publicly** without auth.

---

## Common Misconceptions

> *"`runtime/metrics` replaces all of `MemStats` one-to-one."*

Mostly, but not exactly. Most `MemStats` fields map to a metric, a few are aggregated differently, and `runtime/metrics` adds things `MemStats` never had (histograms, CPU-time breakdown). The mapping is documented; it is not always a rename.

> *"Reading metrics stops the world like `ReadMemStats`."*

No. Avoiding stop-the-world is a core reason the package exists. Most reads are cheap snapshots.

> *"If a metric name is wrong, `Read` returns an error."*

No. It sets that sample's `Kind()` to `KindBad`. You must check.

> *"A `Value` is just a number I can use directly."*

No. It is a tagged union. Inspect `Kind()`, then use the matching accessor.

> *"The set of metrics is fixed."*

No — that is the whole point. New Go versions add metrics. Some are even marked unstable and may change. Discover at runtime.

> *"Histograms give me an average."*

No. They give you a bucketed distribution. You compute averages, percentiles, or counts from `Counts`/`Buckets` yourself.

---

## Tricky Points

- **`metrics.Read` reuses your `Value` storage.** Each call overwrites the previous values in place; keep your own copy if you need history.
- **`KindBad` is silent.** No log, no error — just a kind you have to test for.
- **Some metrics are "unstable"** per the docs and may change format or disappear; `All()`'s descriptions and the package docs flag stability. Lean on the stable ones for production dashboards.
- **The unit is part of the name.** `/gc/heap/allocs:bytes` and a hypothetical `:objects` variant are *different metrics*. Always include the full name, colon and unit included.
- **Histogram bucket edges can be infinite.** `math.Inf(-1)` and `math.Inf(1)` appear as the outermost edges of some histograms.
- **Cumulative metrics survive across GC cycles** — they are lifetime totals, not per-cycle.

---

## Test

Try this in a scratch folder.

```bash
mkdir metrics-test && cd metrics-test
go mod init example.com/mt
cat > main.go <<'EOF'
package main

import (
    "fmt"
    "runtime/metrics"
)

func main() {
    s := []metrics.Sample{
        {Name: "/sched/goroutines:goroutines"},
        {Name: "/memory/classes/heap/objects:bytes"},
        {Name: "/does/not/exist:bytes"},
    }
    metrics.Read(s)
    for _, m := range s {
        fmt.Printf("%-45s kind=%v\n", m.Name, m.Value.Kind())
    }
}
EOF
go run .
```

Expected: the first two print `KindUint64`, the third prints `KindBad`.

Now answer:
1. What happens if you call `s[0].Value.Float64()`? (Answer: it panics — the value is `KindUint64`.)
2. How many goroutines does a tiny program like this report? (Answer: a small handful — `main` plus runtime helpers.)
3. Where would you find a metric's human description? (Answer: `metrics.All()[i].Description`.)
4. Is `/gc/heap/allocs:bytes` cumulative? (Answer: yes — check `Description.Cumulative`.)

---

## Tricky Questions

**Q1.** I read `/sched/goroutines:goroutines` and got `KindBad`. Why?

A. Almost certainly a typo in the name (the unit suffix or a slash). Compare against the exact string in `metrics.All()`. The metric itself has existed since 1.16.

**Q2.** Can I read every metric at once by passing `All()` to `Read`?

A. You can: build a `[]Sample` from every `Description.Name`, then `Read`. It is fine for a dump tool, but wasteful as a periodic collector — read only what you graph.

**Q3.** Why is reading a single value so many lines compared to `MemStats`?

A. The verbosity buys forward-compatibility and stop-the-world avoidance. For one-off debugging, a `MemStats` field is quicker; for production telemetry, the extra lines are worth it.

**Q4.** What is the difference between `/gc/heap/allocs:bytes` and `/memory/classes/heap/objects:bytes`?

A. The first is cumulative bytes *ever* allocated to the heap (a counter). The second is bytes *currently* occupied by live objects (a gauge). Different questions, different shapes.

**Q5.** My histogram has `len(Buckets) == 51` and `len(Counts) == 50`. Bug?

A. No — that is correct. There is always exactly one more bucket boundary than there are counts.

**Q6.** Does reading metrics slow my program down?

A. Negligibly, if you reuse the sample slice and read on a sane cadence. The runtime tracks these numbers anyway; you are only snapshotting.

**Q7.** Where do `/cpu/*` metrics come from and why might they be missing?

A. They were added in Go 1.20. On 1.19 or earlier they read `KindBad`. They break CPU time into GC, scavenge, and user categories.

**Q8.** Can I write or reset a metric?

A. No. `runtime/metrics` is read-only. There is no reset; cumulative counters are lifetime totals.

**Q9.** Are these metrics per-goroutine?

A. No. They are whole-process. `/sched/goroutines:goroutines` is the total live count, not a per-goroutine value.

**Q10.** Which should I prefer for a periodic logger, `ReadMemStats` or `runtime/metrics`?

A. `runtime/metrics` — it avoids the stop-the-world pause that `ReadMemStats` imposes on every goroutine.

---

## Cheat Sheet

```go
import "runtime/metrics"

// 1. Discover (once, at startup)
for _, d := range metrics.All() {
    _ = d.Name        // "/sched/goroutines:goroutines"
    _ = d.Description // human text
    _ = d.Kind        // expected value kind
    _ = d.Cumulative  // counter (true) or gauge (false)
}

// 2. Sample (build slice once, read repeatedly)
samples := []metrics.Sample{
    {Name: "/sched/goroutines:goroutines"},
    {Name: "/gc/pauses:seconds"},
}
metrics.Read(samples)

// 3. Read back by Kind
for _, s := range samples {
    switch s.Value.Kind() {
    case metrics.KindUint64:
        _ = s.Value.Uint64()
    case metrics.KindFloat64:
        _ = s.Value.Float64()
    case metrics.KindFloat64Histogram:
        h := s.Value.Float64Histogram()
        _ = h.Counts  // len N
        _ = h.Buckets // len N+1
    case metrics.KindBad:
        // not supported on this Go version
    }
}
```

| Name | Kind | Meaning |
|------|------|---------|
| `/sched/goroutines:goroutines` | Uint64 | live goroutines (gauge) |
| `/memory/classes/heap/objects:bytes` | Uint64 | live heap bytes (gauge) |
| `/gc/heap/allocs:bytes` | Uint64 | total bytes allocated (counter) |
| `/gc/cycles/total:gc-cycles` | Uint64 | total GC cycles (counter) |
| `/gc/pauses:seconds` | Histogram | GC pause durations |
| `/sched/latencies:seconds` | Histogram | goroutine scheduling latency |

```
Histogram layout:

  Buckets: [ b0   b1   b2   b3 ]     (len N+1)
  Counts:  [   c0   c1   c2   ]      (len N)

  c0 covers [b0, b1)   c1 covers [b1, b2)   ...
  b0 may be -Inf, last bucket may be +Inf
```

---

## Self-Assessment Checklist

You can move on to [middle.md](middle.md) when you can:

- [ ] Explain in one sentence what `runtime/metrics` is and what it replaces
- [ ] Split a metric name into its path and unit
- [ ] List all metrics with `metrics.All()` and read a `Description`
- [ ] Read a single `Uint64` metric, with the `Kind()` check
- [ ] Read several metrics in one `metrics.Read` call
- [ ] Read a `Float64Histogram` and iterate `Counts`/`Buckets` correctly
- [ ] Explain why `len(Buckets) == len(Counts)+1`
- [ ] Detect and handle `KindBad`
- [ ] Distinguish a cumulative counter from a gauge
- [ ] Explain why `runtime/metrics` avoids the stop-the-world cost of `ReadMemStats`
- [ ] Reuse a `[]Sample` slice instead of allocating per read

---

## Summary

`runtime/metrics` is the modern, supported way to read numbers about the running Go runtime — heap memory, goroutine counts, GC pauses, scheduler latency, CPU time. Metrics are named by self-describing slash-paths with a unit suffix (`/sched/goroutines:goroutines`), discovered at runtime with `metrics.All()`, and sampled in batch with `metrics.Read`.

Every read returns a `Value` you inspect via `Kind()` — `Uint64`, `Float64`, `Float64Histogram`, or `Bad` — then read with the matching accessor. Histograms are two parallel slices, `Counts` and `Buckets`, with one extra bucket boundary. Unknown names read as `KindBad` rather than erroring, which is how the package stays forward-compatible across Go versions.

Compared to the frozen `runtime.MemStats` and its stop-the-world `ReadMemStats`, this package is richer, cheaper, and able to grow. Build your sample slice once, check `Kind()` every time, respect the unit suffix, and you have everything a junior needs to read the runtime safely.

---

## What You Can Build

After learning this:

- **A runtime health logger** that prints goroutines, heap, and GC cycles every few seconds.
- **A tiny `/metrics`-style endpoint** that dumps selected runtime values as JSON.
- **A GC pause inspector** that prints the pause-time distribution for a workload.
- **A leak detector** that watches goroutine count climb under load.
- **A `MemStats`-to-metrics migration** in an existing service, removing stop-the-world reads.

You cannot yet:
- Wire these into Prometheus with the right counter/gauge types (next: middle and senior).
- Reason about sampling cadence, cost, and cardinality at scale (senior).
- Build a production collector that survives Go version skew (professional).

---

## Further Reading

- [`runtime/metrics` package docs](https://pkg.go.dev/runtime/metrics) — authoritative, lists every metric and its kind.
- [`runtime/metrics` — naming and stability](https://pkg.go.dev/runtime/metrics#hdr-Metric_key_format) — how names and units are formed.
- [Go 1.16 release notes](https://go.dev/doc/go1.16) — the version that introduced the package.
- [`runtime.ReadMemStats`](https://pkg.go.dev/runtime#ReadMemStats) — the older API this supersedes.
- [Proposal: runtime/metrics](https://github.com/golang/proposal/blob/master/design/37112-go-metrics.md) — the design rationale.

---

## Related Topics

- [17.5 `GODEBUG` and `runtime/debug`](../05-godebug-and-runtime-debug/junior.md) — tuning and forcing GC, the write-side companion to this read-side package
- [17.2 `expvar`](../02-expvar/junior.md) — publishing variables over HTTP; often fed by `runtime/metrics`
- [17.4 OpenTelemetry in Go](../04-opentelemetry-in-go/junior.md) — exporting runtime metrics through OTel
- 13 The Go Runtime — GC, scheduler, and memory model these metrics observe
- 14 Profiling — `pprof`, the deeper-dive companion to lightweight metrics

---

## Diagrams & Visual Aids

```
Metric name anatomy:

    /gc/heap/allocs : bytes
    └──── path ────┘ └ unit┘
        what            how to read it

    /sched   → scheduler family
    /memory  → memory taxonomy family
    /gc      → garbage collector family
    /cpu     → CPU-time family (Go 1.20+)
    /sync    → sync primitives family
```

```
The two phases:

    [ startup ]                    [ runtime, repeatedly ]
    metrics.All()                  metrics.Read(samples)
        │                                │
        ▼                                ▼
    []Description                    fills samples[i].Value
    (what exists)                    (current values)
```

```
Value is a tagged union:

    Value
    ├── Kind() == KindUint64            → Uint64()
    ├── Kind() == KindFloat64           → Float64()
    ├── Kind() == KindFloat64Histogram  → Float64Histogram()
    └── Kind() == KindBad               → (unsupported; skip)

    Wrong accessor for the kind → panic.
```

```
ReadMemStats vs runtime/metrics:

    runtime.ReadMemStats(&ms)        metrics.Read(samples)
            │                                │
    stops the world  ✗               no stop-the-world  ✓
    fixed struct, frozen             named, extensible
    no histograms                    histograms + CPU time
```
