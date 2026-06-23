---
layout: default
title: Professional
parent: Timer Leaks
grand_parent: Time-Based Concurrency
ancestor: Go
nav_order: 5
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/16-time-based-concurrency/03-timer-leaks/professional/
---

# Timer Leaks — Professional Level (Detection, Telemetry, Retrofits)

## Table of Contents
1. [Introduction](#introduction)
2. [Why Timer Leaks Are Different](#why-timer-leaks-are-different)
3. [What Production Looks Like When Timers Leak](#what-production-looks-like-when-timers-leak)
4. [The Runtime Timer Heap, Briefly](#the-runtime-timer-heap-briefly)
5. [Detection Layer One: `runtime.MemStats`](#detection-layer-one-runtimememstats)
6. [Detection Layer Two: `pprof` Heap Profiles](#detection-layer-two-pprof-heap-profiles)
7. [Detection Layer Three: `pprof` Goroutine Profiles](#detection-layer-three-pprof-goroutine-profiles)
8. [Detection Layer Four: Allocation Profiles](#detection-layer-four-allocation-profiles)
9. [Detection Layer Five: Execution Traces](#detection-layer-five-execution-traces)
10. [Detection Layer Six: Live Timer Count Metric](#detection-layer-six-live-timer-count-metric)
11. [Goleak in CI](#goleak-in-ci)
12. [Building a Leak Reproducer](#building-a-leak-reproducer)
13. [Real Incident: The `time.After` RPC Loop](#real-incident-the-timeafter-rpc-loop)
14. [Real Incident: The Forgotten `Reset`](#real-incident-the-forgotten-reset)
15. [Real Incident: The Cancelled `context.Context` That Wasn't](#real-incident-the-cancelled-contextcontext-that-wasnt)
16. [Real Incident: The `Ticker` Inside a Hot Path](#real-incident-the-ticker-inside-a-hot-path)
17. [Real Incident: The Reconnect Loop](#real-incident-the-reconnect-loop)
18. [Real Incident: The Per-Request Health Check](#real-incident-the-per-request-health-check)
19. [Postmortem Template for Timer Leaks](#postmortem-template-for-timer-leaks)
20. [Retrofitting Old Codebases](#retrofitting-old-codebases)
21. [Static Analysis: `vet`, `staticcheck`, Custom Analyzers](#static-analysis-vet-staticcheck-custom-analyzers)
22. [Wrappers That Make Misuse Hard](#wrappers-that-make-misuse-hard)
23. [Capacity Planning and Cost of Timers](#capacity-planning-and-cost-of-timers)
24. [Continuous Profiling in Production](#continuous-profiling-in-production)
25. [Self-Assessment](#self-assessment)
26. [Summary](#summary)

---

## Introduction

A leak that needs three days to manifest is the most expensive bug a Go service can carry. It survives unit tests, survives integration tests, survives canary windows, survives smoke tests, survives the entire pre-production gauntlet, and is then released into the fleet where it sits quietly accumulating cost for the lifetime of every long-running process. Timer leaks are this kind of bug. They do not break the binary; they erode it. Heap grows by a few hundred kilobytes per hour, goroutine count drifts upward by a handful per minute, GC cycles take a little longer each pass, the timer heap fills with entries scheduled hours into the future, and eventually the process either hits a memory limit, slows below its SLO, or is restarted as a routine maintenance action that masks the underlying cause for another release cycle.

This document is about how to find timer leaks before they cost you a postmortem, and how to retrofit a fleet that already has them. We are going to look at the runtime's timer machinery in just enough detail to understand what a "leaked" timer actually is, what the runtime keeps alive on its behalf, and what each diagnostic surface in the Go toolchain shows about it. We will then build a stack of detection layers from the simplest (a metric scraped every fifteen seconds) to the most invasive (a tracing build that records every timer event), and we will walk through six real incidents drawn from production postmortems. Finally, we will design retrofits — code review patterns, linters, wrappers, telemetry, and CI guards — that turn the implicit risk of `time.After` and friends into something a team can carry safely.

The audience for this file is engineers who already know how to *use* `time.After`, `time.NewTimer`, `time.AfterFunc`, and `time.Ticker`. The junior file in this same folder covers the basic mechanics: how the API behaves, when timers fire, what `Stop` returns, what the standard idioms are. Here we assume that foundation and focus on *operating* a Go service in which timers may leak — observing them, attributing them, fixing them, and preventing regressions.

A note on Go versions. The timer machinery underwent a major rewrite in Go 1.23, which dramatically reduced the cost of `time.After` and made many old idioms obsolete. We will call out where 1.21, 1.22, and 1.23 differ — but most of this document is structured around the *worst case*, which is the pre-1.23 behaviour, because most production fleets run a mix of versions and any retrofitting plan must support the oldest binaries in the field.

---

## Why Timer Leaks Are Different

Timer leaks share a family resemblance with goroutine leaks and channel-blocking leaks, but they have three properties that set them apart and that drive the rest of this document.

### Property one: timers are runtime-managed, not goroutine-backed

Every other concurrency primitive in Go that can leak — a channel, a mutex, a goroutine — has a corresponding object in user code that you can reach and inspect. A leaked goroutine appears in `runtime.Stack`. A leaked channel send is a goroutine blocked in `chansend`, visible in any goroutine profile. A leaked mutex hold is, in the worst case, a goroutine blocked in `sync.(*Mutex).Lock`, also visible. But a leaked timer is, by default, *not* a goroutine. It is an entry in an internal min-heap managed by the runtime; until it fires (or you call `Stop`), it consumes memory and a slot in the heap, but there is no goroutine attached to it. Goroutine profiling will not find it. Stack traces will not find it. The only places where a leaked timer surfaces are heap profiles (under `time.NewTimer`, `time.startTimer`, or similar symbols), the timer-count statistics exposed by the runtime, and execution traces.

This means the standard "is anything leaking?" debugging recipe — dump goroutines, look for unbounded growth, find the function that spawns them — does not work for timer leaks. You need to learn a different set of tools.

### Property two: a leaked timer is GC-reachable

When you write `time.After(5*time.Second)`, the runtime allocates a `*runtime.timer` (or a `*time.Timer` wrapping one, depending on Go version) and registers it with the per-P timer heap. Even after you drop your reference to the returned channel, the runtime still holds a reference to the timer through the heap. The GC therefore cannot collect the timer until it fires or is stopped — even if no user-code reference exists. This is critical: it explains why timer leaks accumulate over hours instead of being cleaned up on the next GC. The runtime is, in a precise sense, *keeping the leak alive on your behalf*.

Go 1.23 weakened this: now stopped timers and timers without active channel receivers can be collected more aggressively, but the model is still "the runtime owns the timer until it expires." In any version, the correct mental model is: a timer occupies runtime memory for at least `duration` after it is started, no matter what user code does with the returned channel.

### Property three: the cost is silent and gradual

A leaked goroutine costs at least 2 KiB of stack plus its `g` struct (~376 bytes on amd64). A leaked timer costs roughly 80–120 bytes for the `timer` struct, plus the channel it owns (~96 bytes), plus a slot in the per-P timer heap. The total per-timer cost is on the order of 200 bytes. A service that allocates one leaked timer per RPC at 10,000 RPC/s leaks roughly 2 MiB/s — small enough to be invisible on a memory chart for the first hour, but ruinous over a day. Compare this to a leaked goroutine, which leaks 10× as much memory per occurrence and is therefore noticed sooner.

Timer leaks have another silent dimension: they degrade GC pause times. Every timer in the heap is a root, in effect — the runtime must walk the timer heap on every GC cycle. A million timers in the heap can add tens of milliseconds to GC pause time, which is the kind of degradation that shows up in a tail-latency dashboard long before it shows up in a memory dashboard.

---

## What Production Looks Like When Timers Leak

Before we instrument anything, let's establish what timer leaks look like *to the operator*. Knowing the symptoms is half the battle, because most timer leaks are first observed indirectly — through their downstream effects on the GC, the heap, the scheduler, or the API SLOs.

### Symptom one: slowly rising heap

Run `kubectl top pod` or your equivalent every few hours. A service with no leak has a sawtooth heap pattern: GC drops it, allocation raises it, GC drops it again. A service with a timer leak has the same sawtooth — but the *baseline* drifts upward by a small percentage per hour. The minimum value of the sawtooth after each GC is the live heap, and that minimum grows linearly with uptime. After three days, the live heap might be 1.8 GiB on a process that started at 200 MiB.

This is the most reliable symptom, but it is unspecific: any leak (timers, goroutines, caches, log buffers) produces it. The next symptoms narrow the search.

### Symptom two: rising goroutine count without obvious cause

Even though leaked timers are not goroutines, they are usually *coupled* to goroutine leaks. For example: a goroutine waits in a `select` that has a `time.After` branch. If the goroutine never exits because the channel it is waiting on never closes, the `time.After` timer is leaked alongside the goroutine. So in practice, timer leaks often co-occur with goroutine leaks, and a rising goroutine count is a useful early-warning signal.

### Symptom three: increasing GC CPU share

`GOGC=100` (the default) targets a steady-state heap that is roughly 2× the live heap. As the live heap grows, GC has more work per cycle, and the fraction of CPU spent in GC grows. The Go runtime exposes this fraction; if your dashboard shows GC CPU rising from 3% to 8% to 12% over the course of a week of uninterrupted uptime, something is leaking. Timers contribute to this because every timer in the heap is a memory allocation the GC must trace.

### Symptom four: degraded tail latency

The 99th percentile latency of an API drifts upward over days. The mean is stable; the median is stable; only the tail moves. This is the signature of a GC problem: longer pauses make a handful of requests slow without affecting the average. Timer leaks contribute to this because (a) they grow the heap, lengthening GC pauses, and (b) they grow the per-P timer heap, lengthening the time the scheduler spends checking for ready timers.

### Symptom five: rising `runtime.NumGoroutine()` plotted against a flat `runtime.MemStats.Mallocs - Frees`

This one is more subtle: if your fleet exports both `runtime.NumGoroutine()` and the live allocation count `Mallocs - Frees`, and both grow in parallel, you have a goroutine leak. If goroutines are flat and `Mallocs - Frees` grows, you have something else — possibly a timer leak, possibly a regular memory leak. We will refine this signal below.

### Symptom six: an alarm that fires once and goes away

A timer leak can produce a very specific alarm: a single brief spike of heap growth at the moment of process startup, followed by smooth growth. The startup spike is the worker pool initializing; the smooth growth is timers slowly accumulating. Operators often dismiss this pattern as "warmup" and move on. Don't.

---

## The Runtime Timer Heap, Briefly

To debug timer leaks effectively, you need to know what the runtime is doing on your behalf. This section is a compressed tour; for the full picture see the specification file.

In Go 1.14 and later, every `P` (logical processor) owns a min-heap of pending timers, sorted by `when` (the absolute time at which the timer should fire, in monotonic nanoseconds). When you call `time.NewTimer(d)`, the runtime:

1. Allocates a `time.Timer` struct, which contains a `C chan Time` and an embedded `runtimeTimer`.
2. Computes `when = nanotime() + int64(d)`.
3. Calls `runtime.addtimer`, which inserts the timer into the local P's timer heap. (Before 1.14, all timers lived on a single global heap behind a global mutex; this was the bottleneck the per-P design fixed.)
4. Returns the `*time.Timer`.

When the timer's `when` arrives, the runtime, via `sysmon` and the scheduler, sends the current time on `t.C`. If nothing is reading from `t.C`, the send blocks — but only briefly, because `t.C` has a buffer of size 1. The send completes, the timer's state is `timerDeleted` (Go 1.14+ terminology), and the timer is removed from the heap on the next opportunity.

When you call `t.Stop()`, the runtime atomically transitions the timer's state and arranges for it to be removed from the heap. If the timer had already fired and the value sits in `t.C`, `Stop` returns `false`; otherwise it returns `true`. The classic drain pattern,

```go
if !t.Stop() {
    <-t.C
}
```

is needed because if the timer has fired but no one has read `t.C`, the next `select` over `t.C` will spuriously trigger.

The cost of a timer is therefore:
- The `time.Timer` struct (`runtimeTimer` ~80 bytes + `chan Time` ~96 bytes ≈ 176 bytes).
- A slot in the per-P timer heap (8–16 bytes).
- An entry in the GC's root set until the timer is removed from the heap.

Multiply by the number of leaked timers and you have your accounting.

### `time.After` is just sugar

The implementation of `time.After` in `time/sleep.go` is approximately:

```go
func After(d Duration) <-chan Time {
    return NewTimer(d).C
}
```

Note what is *not* there: any way to call `Stop` on the timer. The `*Timer` is dropped, only its `C` channel survives, and the runtime keeps the timer in its heap until `d` elapses. This is the entire reason for the slogan "don't use `time.After` in loops."

### Go 1.23: a major rewrite

Go 1.23 changed two things relevant to leak debugging:

1. When a `*Timer` becomes unreachable (i.e., no goroutine holds a reference to it and no one is reading from `t.C`), it can now be garbage collected even if it has not fired. The runtime arranges this through a special weak-reference mechanism on the timer's internal state.
2. The timer's channel `t.C` is created with a "synchronous" delivery model rather than the old async send-to-buffer pattern.

In practice, this means many `time.After` leaks that were catastrophic in Go 1.21 become merely "wasteful" in Go 1.23: the timer is still allocated and still consumes CPU until the next GC, but it does not accumulate indefinitely. Crucially, **this only helps if the surrounding code drops references to the channel**. If a goroutine sits in `select { case <-ch: ...; case <-time.After(d): ... }` and `ch` never delivers, the goroutine still holds the channel reference and the timer is still leaked. The Go 1.23 change cannot rescue you from a goroutine leak.

We will return to version differences throughout this document; for now, the key point is that no version of Go saves you from a leaked goroutine that owns a timer's channel.

---

## Detection Layer One: `runtime.MemStats`

The cheapest, lowest-overhead leak detector you can deploy is `runtime.ReadMemStats`. It returns a snapshot of memory statistics, including counters that grow over the process lifetime. By scraping these counters every 15–30 seconds and exporting them as metrics, you can detect leaks of any kind — including timer leaks — with very little cost.

The relevant fields are:

| Field | Meaning |
|---|---|
| `HeapAlloc` | Bytes of allocated heap objects |
| `HeapObjects` | Number of allocated heap objects |
| `Mallocs` | Cumulative count of allocations |
| `Frees` | Cumulative count of frees |
| `NumGC` | Number of GC cycles run |
| `NextGC` | Target heap size for next GC |
| `PauseTotalNs` | Cumulative GC pause time |
| `LastGC` | Time of last GC |
| `Sys` | Total bytes of memory obtained from the OS |

The two derived quantities that matter most for leak detection are:

- **Live heap**: `HeapAlloc` immediately after a GC. This is the floor of the sawtooth.
- **Live objects**: `Mallocs - Frees`. This is the number of objects currently alive, regardless of size.

A timer leak shows up as a slowly growing `Mallocs - Frees` (each leaked timer is one or two objects) and a slowly growing `HeapAlloc` floor.

### Exporting the metrics

Here is a minimal exporter that you can drop into any service:

```go
package memstats

import (
    "runtime"
    "time"

    "github.com/prometheus/client_golang/prometheus"
)

type Exporter struct {
    HeapAlloc      prometheus.Gauge
    HeapObjects    prometheus.Gauge
    LiveObjects    prometheus.Gauge
    NumGC          prometheus.Counter
    PauseTotalNs   prometheus.Counter
    Goroutines     prometheus.Gauge
    lastPauseTotal uint64
    lastNumGC      uint32
}

func New(reg prometheus.Registerer) *Exporter {
    e := &Exporter{
        HeapAlloc: prometheus.NewGauge(prometheus.GaugeOpts{
            Name: "go_heap_alloc_bytes",
            Help: "Current heap allocation in bytes",
        }),
        HeapObjects: prometheus.NewGauge(prometheus.GaugeOpts{
            Name: "go_heap_objects",
            Help: "Number of allocated heap objects",
        }),
        LiveObjects: prometheus.NewGauge(prometheus.GaugeOpts{
            Name: "go_live_objects",
            Help: "Mallocs minus frees",
        }),
        NumGC: prometheus.NewCounter(prometheus.CounterOpts{
            Name: "go_gc_cycles_total",
            Help: "Total GC cycles",
        }),
        PauseTotalNs: prometheus.NewCounter(prometheus.CounterOpts{
            Name: "go_gc_pause_total_nanoseconds",
            Help: "Cumulative GC pause time in nanoseconds",
        }),
        Goroutines: prometheus.NewGauge(prometheus.GaugeOpts{
            Name: "go_goroutines",
            Help: "Number of goroutines",
        }),
    }
    reg.MustRegister(e.HeapAlloc, e.HeapObjects, e.LiveObjects,
        e.NumGC, e.PauseTotalNs, e.Goroutines)
    return e
}

func (e *Exporter) Run(interval time.Duration, stop <-chan struct{}) {
    t := time.NewTicker(interval)
    defer t.Stop()
    var ms runtime.MemStats
    for {
        select {
        case <-stop:
            return
        case <-t.C:
            runtime.ReadMemStats(&ms)
            e.HeapAlloc.Set(float64(ms.HeapAlloc))
            e.HeapObjects.Set(float64(ms.HeapObjects))
            e.LiveObjects.Set(float64(ms.Mallocs - ms.Frees))
            if ms.NumGC > e.lastNumGC {
                e.NumGC.Add(float64(ms.NumGC - e.lastNumGC))
                e.lastNumGC = ms.NumGC
            }
            if ms.PauseTotalNs > e.lastPauseTotal {
                e.PauseTotalNs.Add(float64(ms.PauseTotalNs - e.lastPauseTotal))
                e.lastPauseTotal = ms.PauseTotalNs
            }
            e.Goroutines.Set(float64(runtime.NumGoroutine()))
        }
    }
}
```

This costs almost nothing in steady state — `ReadMemStats` is fast (microseconds) but it does stop-the-world briefly. At 15-second intervals the overhead is negligible.

### What to alert on

The slope of `go_live_objects` over a 24-hour window is the single most useful leak signal. A healthy service has a flat or sawtooth slope; a leaky service has a positive linear slope. Configure an alert that fires when `deriv(go_live_objects[6h]) > 100/s` (or some service-appropriate threshold) — this catches leaks early, before they affect availability.

A more specific timer-leak signal: divide `go_live_objects` by `go_goroutines`. If the ratio grows, you are leaking objects that are not goroutines — a strong hint at timers, channels, or caches.

### Limitations of `MemStats`

`MemStats` does not distinguish between timer leaks and other heap leaks. It tells you *something* is leaking but not *what*. To attribute, you need pprof.

### `runtime/metrics` (Go 1.16+)

A more modern alternative to `MemStats` is the `runtime/metrics` package. It exposes a stable set of metric names with explicit units. Notable for our purposes:

```go
import "runtime/metrics"

samples := []metrics.Sample{
    {Name: "/sched/goroutines:goroutines"},
    {Name: "/gc/heap/objects:objects"},
    {Name: "/gc/heap/allocs:bytes"},
    {Name: "/gc/cycles/total:gc-cycles"},
    {Name: "/sched/latencies:seconds"},
}
metrics.Read(samples)
```

`runtime/metrics` is preferred over `MemStats` because it doesn't stop-the-world. It also covers some metrics `MemStats` doesn't, like scheduler latency histograms — which are useful for noticing that GC pauses are eating into runnable goroutines.

There is, regrettably, no `/timers/total` metric in the standard runtime/metrics namespace in any Go version up to 1.23. The closest available is `/gc/heap/objects:objects`, which counts all heap objects. We will build our own timer counter later in this document.

---

## Detection Layer Two: `pprof` Heap Profiles

`pprof` heap profiles are the most powerful tool for attributing memory growth to specific allocation sites. A heap profile is a sampled list of allocation call stacks, weighted by the number of bytes (or objects) currently alive. For timer leak debugging it is indispensable, because `time.NewTimer` allocations show up at very specific symbols.

### Enabling pprof in production

The cheapest and most reliable approach is `net/http/pprof`. Import it for side effects and serve it on a dedicated debug port:

```go
import (
    "net/http"
    _ "net/http/pprof"
)

func init() {
    go func() {
        // Bind only to localhost or to an internal NIC.
        http.ListenAndServe("127.0.0.1:6060", nil)
    }()
}
```

Profile endpoints (assuming default `mux`):

- `/debug/pprof/heap` — current heap profile
- `/debug/pprof/goroutine` — goroutine profile
- `/debug/pprof/profile` — CPU profile (default 30 s)
- `/debug/pprof/trace` — execution trace
- `/debug/pprof/allocs` — allocation profile (all allocations since process start, not just live)

### Capturing a heap profile

From a developer's laptop, with port-forwarding into the pod:

```sh
kubectl port-forward pod/api-7d5 6060:6060 &
go tool pprof -http=:0 http://localhost:6060/debug/pprof/heap
```

This launches a browser with the interactive pprof UI. The `inuse_space` view (the default) shows currently-alive memory grouped by call stack. For timer leaks, look for stacks that include:

- `time.NewTimer`
- `time.startTimer`
- `time.After`
- `time.AfterFunc`
- `runtime.addtimer`

In `inuse_objects` view, the same stacks show how many timer objects are currently alive. The ratio of `inuse_space` to `inuse_objects` for each stack is roughly the per-object size: for `time.NewTimer`, expect 80–200 bytes per object depending on the version.

### Reading a heap profile

A typical leaky service's `inuse_objects` view, sorted by self count:

```
      flat  flat%   sum%        cum   cum%
   1.2M     35%    35%       1.2M    35%   time.NewTimer
    600K    17%    52%        600K    17%   time.After (inline)
    250K     7%    59%        250K     7%   bytes.makeSlice
    ...
```

If `time.NewTimer` or `time.After` is the top entry, you have a timer leak. The diff against a profile taken an hour earlier confirms it:

```sh
go tool pprof -base=heap-baseline.pb.gz -http=:0 heap-now.pb.gz
```

The base view shows only growth since the baseline, which makes leaks unambiguous: only leaked allocation sites have non-zero growth.

### `runtime.SetBlockProfileRate` and friends

In addition to the heap profile, the runtime exposes:

- `SetBlockProfileRate(rate int)` — captures profiles of goroutines blocked on synchronization
- `SetMutexProfileFraction(rate int)` — captures contended mutex stacks

Neither of these directly catches timer leaks, but they are useful when investigating *related* problems (e.g., a goroutine leaked because it was blocked on a mutex, dragging a timer with it).

### Sampling rate and accuracy

The default heap profile sampling rate is one sample per 512 KiB allocated. For a typical timer leak you need *thousands* of leaked timers before any individual stack shows up. For more sensitive detection, set:

```go
runtime.MemProfileRate = 1024 // sample every 1 KiB
```

at process startup. This costs CPU (memory profile overhead grows roughly linearly with sample rate), but for staging or development debugging it's worth it.

### Programmatic capture

For automated capture (e.g., a "snapshot every hour and ship to S3" job):

```go
package profile

import (
    "context"
    "fmt"
    "os"
    "runtime/pprof"
    "time"
)

func SnapshotHeap(ctx context.Context, dir string) error {
    ts := time.Now().UTC().Format("20060102T150405Z")
    path := fmt.Sprintf("%s/heap-%s.pb.gz", dir, ts)
    f, err := os.Create(path)
    if err != nil {
        return err
    }
    defer f.Close()
    if err := pprof.Lookup("heap").WriteTo(f, 0); err != nil {
        return fmt.Errorf("write heap profile: %w", err)
    }
    return nil
}

func RunHourly(ctx context.Context, dir string) {
    t := time.NewTicker(1 * time.Hour)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            if err := SnapshotHeap(ctx, dir); err != nil {
                // log and continue
            }
        }
    }
}
```

Adapt to your storage backend; the key is that you have one profile per hour available to diff against once you suspect a leak.

### Heap profile gotcha: `inuse_space` lies about timers (slightly)

The timer object itself is small, but it holds a reference to a channel, which is allocated separately. In the heap profile, the channel allocation shows up under a different stack (`runtime.makechan`), so the per-timer cost is split across two stacks. To get the true per-timer cost, you need to look at both `time.NewTimer` and the channel allocation it triggers. In practice, looking at `time.NewTimer` alone is sufficient to attribute the leak; you just have to remember that the *total* memory cost is roughly double the count multiplied by the size shown for the `NewTimer` line.

---

## Detection Layer Three: `pprof` Goroutine Profiles

A goroutine profile is a snapshot of every goroutine in the process with its call stack. It is captured from:

```sh
curl -o goroutines.pb.gz http://localhost:6060/debug/pprof/goroutine
go tool pprof -http=:0 goroutines.pb.gz
```

Or, for human-readable output:

```sh
curl http://localhost:6060/debug/pprof/goroutine?debug=2
```

While leaked *timers* are not goroutines, **leaked goroutines often drag timers with them**. Specifically, a goroutine in this state is a strong indicator of a paired timer leak:

```
goroutine 12345 [select, 4 minutes]:
main.handler(...)
    /app/handler.go:42 +0x108
created by main.serve in goroutine 1
    /app/server.go:88 +0x60
```

The `[select, 4 minutes]` tag tells you a goroutine has been parked in a select for four minutes. If the select includes a `time.After` branch, that timer is leaked alongside the goroutine.

### Identifying suspicious goroutines

Look for stacks with high count and `[chan receive]` or `[select]` parking reasons. A leak pattern is:

```
goroutine profile: total 142000
   141500 @ 0x4f8c00 0x4f8d60 0x4f9000 0x509b00 ...
#   0x509aff   main.waitForReply+0x5f   /app/rpc.go:88
#   0x509200   main.handleRequest+0x40  /app/rpc.go:42
```

When a single stack accounts for >90% of goroutines and is parked in `chan receive` or `select`, you have a leak. Open `rpc.go:88` and look for either an unbounded `<-ch` or a `select` with `time.After` — both are candidates.

### When timer leaks are *not* visible in goroutine profiles

If your leak is purely "spawn a timer, drop the reference, never start a goroutine to wait for it," goroutine profiles will not show anything. Pattern:

```go
for {
    if shouldNotify() {
        time.AfterFunc(5*time.Second, sendAlert) // leaks if shouldNotify is hot
    }
}
```

Here `time.AfterFunc` schedules a function to run later but does not spawn a goroutine until it fires. Each call leaks the `*Timer` struct, but no goroutine is created until the timer fires (and then the runtime borrows one of its own goroutines, briefly). Goroutine profiles are blind to this kind of leak.

### Differential goroutine profiles

If you have two snapshots, diff them by count:

```sh
go tool pprof -base=goroutines-baseline.pb.gz -http=:0 goroutines-now.pb.gz
```

The diff shows stacks whose goroutine count *grew*. This is the most useful single command for finding goroutine leaks in a running service.

### `runtime.Stack` for emergency inspection

When pprof isn't available, you can dump goroutine stacks programmatically:

```go
func dumpStacks() string {
    buf := make([]byte, 1<<20)
    n := runtime.Stack(buf, true)
    return string(buf[:n])
}
```

Pass `true` to include *all* goroutines. For a healthy service this is 5–50 KiB; for a leaking one it can be hundreds of MiB, which is precisely why you should rarely call this in production. Reserve it for crash-handlers and last-ditch debugging.

### Counting goroutines per stack

A useful diagnostic is grouping goroutines by their stack trace and reporting counts:

```go
package gprof

import (
    "fmt"
    "io"
    "runtime/pprof"
    "strings"
)

func WriteSummary(w io.Writer) error {
    p := pprof.Lookup("goroutine")
    var sb strings.Builder
    if err := p.WriteTo(&sb, 1); err != nil {
        return err
    }
    // Format with debug=1 is "count @ stack hash\nstack...\n\n"
    counts := map[string]int{}
    blocks := strings.Split(sb.String(), "\n\n")
    for _, b := range blocks {
        lines := strings.Split(b, "\n")
        if len(lines) < 2 {
            continue
        }
        header := lines[0]
        var n int
        fmt.Sscanf(header, "%d", &n)
        // Use first frame as a coarse key
        if len(lines) >= 3 {
            counts[lines[2]] += n
        }
    }
    for stack, n := range counts {
        if n > 100 { // threshold
            fmt.Fprintf(w, "%5d %s\n", n, stack)
        }
    }
    return nil
}
```

A handler that exposes this on `/debug/goroutines/summary` is a cheap way to spot leaks without leaving the SSH session.

---

## Detection Layer Four: Allocation Profiles

The `inuse_space` heap profile shows currently-alive allocations, which is what you want for finding *current* leaks. But sometimes you want to know which call sites allocate *most often*, even if those allocations are short-lived. The allocation profile is `alloc_space` and `alloc_objects`.

```sh
go tool pprof -alloc_space http://localhost:6060/debug/pprof/heap
```

For timer leak debugging, allocation profiles are useful in one specific case: a "transient" leak where a code path allocates many timers per request but they all get garbage-collected within seconds. The heap profile won't show this (the timers are gone by the time you look) but the allocation profile will. A high `alloc_objects` count for `time.NewTimer` tells you something is hammering on `time.After` even if you don't see live leaks.

This matters because, even pre-1.23 with non-leaking patterns, an extreme volume of timer allocations stresses the GC and the timer heap. A service that allocates 100 K `time.After` calls per second will spend nontrivial CPU in `runtime.addtimer` and `runtime.deltimer`, and will have a hot timer heap on every P. The allocation profile makes this visible.

### `alloc_objects` vs `alloc_space`

For timers, `alloc_objects` is the more useful view, because timer objects are small and uniform. A profile showing `time.NewTimer` at the top of `alloc_objects` but not `alloc_space` tells you you have a *high-rate* problem, not necessarily a *high-volume* problem.

---

## Detection Layer Five: Execution Traces

Execution traces (`runtime/trace`) capture per-goroutine, per-event timelines of what the runtime is doing. They are heavier than profiles — typically 10–100 MiB per minute of capture — but they reveal scheduler behaviour that profiles cannot, including timer-related events.

### Capturing a trace

```sh
curl -o trace.out 'http://localhost:6060/debug/pprof/trace?seconds=30'
go tool trace trace.out
```

This opens a web UI with several views:

- **View trace**: a per-CPU timeline
- **Goroutine analysis**: per-goroutine state distribution
- **Network blocking profile**: time spent waiting on network IO
- **Synchronization blocking profile**: time spent waiting on channels/mutexes

For timer debugging, the most useful trace events are:

- `runtime.timerproc`: the runtime function that fires due timers
- `runtime.goparkunlock` followed by `runtime.goready` with a `wait reason` of `timer`
- Goroutines that wake up after a long park

### What to look for

A trace from a service with a timer leak will show, in the "Synchronization blocking profile," large amounts of time attributed to "timer" wait reasons across many goroutines. Each entry tells you which goroutine, which timer duration, and which call site. Cross-referenced against your code, this often pinpoints the exact `time.After` causing the leak.

### Tracing in production

Execution tracing has nontrivial overhead — typically 1–5% CPU during capture — and produces files large enough that you should not run continuously. Reserve traces for one-off investigations:

1. Set up an alert that fires when goroutines or live objects cross a threshold.
2. On alert, capture a 30-second trace.
3. Ship the trace to S3 for offline analysis.

For most operators, a heap profile diff is sufficient to find the leak. Traces are the next-step tool when the profile alone doesn't tell you *why* timers are leaking.

### `go tool trace` and timer events

The trace tool's event types include `EvTimerGoroutine` (deprecated as of 1.22) and `EvTimer` events for individual fires. The Go 1.23 trace format records timer creation, modification, and deletion as discrete events. Programmatic analysis is possible with `golang.org/x/exp/trace`:

```go
import "golang.org/x/exp/trace"

func analyseTrace(path string) error {
    f, err := os.Open(path)
    if err != nil {
        return err
    }
    defer f.Close()
    r, err := trace.NewReader(f)
    if err != nil {
        return err
    }
    timerCounts := map[string]int{}
    for {
        ev, err := r.ReadEvent()
        if err == io.EOF {
            break
        }
        if err != nil {
            return err
        }
        if ev.Kind() == trace.EventStateTransition {
            st := ev.StateTransition()
            if st.Reason == "timer" {
                stack := ev.Stack().String()
                timerCounts[stack]++
            }
        }
    }
    for stack, n := range timerCounts {
        fmt.Printf("%5d %s\n", n, stack)
    }
    return nil
}
```

For production fleets running tracing in cron-job style, this kind of analysis produces a daily "timer hotspot" report that complements your standing dashboards.

---

## Detection Layer Six: Live Timer Count Metric

So far we have used the standard Go tools. Now we build a custom signal that no standard tool provides: a live count of timers known to the runtime. With this counter you can graph timer-heap size directly, alert on drift, and correlate with deploys.

The Go runtime does not expose a public timer-count API. We need to count timers *ourselves* by intercepting their creation and destruction. The straightforward approach is to provide a thin wrapper around `time.NewTimer`, `time.NewTicker`, and `time.AfterFunc`, increment a counter on creation, and decrement on stop.

### The wrapper package

```go
// Package timed wraps time package primitives with a live counter.
package timed

import (
    "sync/atomic"
    "time"
)

var liveCount int64

// LiveCount returns the number of timers currently outstanding.
func LiveCount() int64 {
    return atomic.LoadInt64(&liveCount)
}

// Timer is a counted wrapper around time.Timer.
type Timer struct {
    *time.Timer
    stopped int32
}

// NewTimer creates a counted timer.
func NewTimer(d time.Duration) *Timer {
    atomic.AddInt64(&liveCount, 1)
    return &Timer{Timer: time.NewTimer(d)}
}

// Stop stops the timer and decrements the counter.
func (t *Timer) Stop() bool {
    if atomic.CompareAndSwapInt32(&t.stopped, 0, 1) {
        atomic.AddInt64(&liveCount, -1)
    }
    return t.Timer.Stop()
}

// Reset resets the timer. If the timer was already stopped, this re-counts it.
func (t *Timer) Reset(d time.Duration) bool {
    if atomic.CompareAndSwapInt32(&t.stopped, 1, 0) {
        atomic.AddInt64(&liveCount, 1)
    }
    return t.Timer.Reset(d)
}

// Ticker is a counted wrapper around time.Ticker.
type Ticker struct {
    *time.Ticker
    stopped int32
}

func NewTicker(d time.Duration) *Ticker {
    atomic.AddInt64(&liveCount, 1)
    return &Ticker{Ticker: time.NewTicker(d)}
}

func (t *Ticker) Stop() {
    if atomic.CompareAndSwapInt32(&t.stopped, 0, 1) {
        atomic.AddInt64(&liveCount, -1)
    }
    t.Ticker.Stop()
}

// AfterFunc schedules f to run after d. The returned Timer can be cancelled.
func AfterFunc(d time.Duration, f func()) *Timer {
    atomic.AddInt64(&liveCount, 1)
    t := &Timer{}
    t.Timer = time.AfterFunc(d, func() {
        if atomic.CompareAndSwapInt32(&t.stopped, 0, 1) {
            atomic.AddInt64(&liveCount, -1)
        }
        f()
    })
    return t
}
```

This wrapper has limitations:

1. It counts only timers created through the wrapper. Anything still using `time.After` or raw `time.NewTimer` bypasses the counter.
2. The counter does not decrement automatically when a timer fires; you must call `Stop` (or schedule the firing through `AfterFunc`, which we patched) or the count remains.

The second limitation is a feature: a timer that fires without being stopped is still occupying the timer heap until the runtime cleans it up, and counting it as "live" until then is honest.

### Forcing fleet adoption

To make the wrapper effective fleet-wide, ban the `time` package's leak-prone APIs and require the wrapper. The simplest enforcement is a custom analyzer.

```go
// Package banafter is a vet-style analyzer that forbids time.After in selects.
package banafter

import (
    "go/ast"
    "golang.org/x/tools/go/analysis"
)

var Analyzer = &analysis.Analyzer{
    Name: "banafter",
    Doc:  "Forbid time.After (use timed.NewTimer with explicit Stop instead)",
    Run:  run,
}

func run(pass *analysis.Pass) (interface{}, error) {
    for _, file := range pass.Files {
        ast.Inspect(file, func(n ast.Node) bool {
            call, ok := n.(*ast.CallExpr)
            if !ok {
                return true
            }
            sel, ok := call.Fun.(*ast.SelectorExpr)
            if !ok {
                return true
            }
            ident, ok := sel.X.(*ast.Ident)
            if !ok {
                return true
            }
            if ident.Name == "time" && sel.Sel.Name == "After" {
                pass.Reportf(call.Pos(),
                    "time.After is forbidden; use timed.NewTimer with Stop")
            }
            return true
        })
    }
    return nil, nil
}
```

Wire this into your CI, fail the build on violations, and you have an enforced policy. Combined with the wrapper's metric, you now have observability *and* a guarantee that everything counted is being counted.

### Exporting the counter

```go
import (
    "github.com/prometheus/client_golang/prometheus"
    "yourorg/timed"
)

var liveTimersGauge = prometheus.NewGaugeFunc(
    prometheus.GaugeOpts{
        Name: "go_live_timers",
        Help: "Number of timers outstanding (created through timed package)",
    },
    func() float64 {
        return float64(timed.LiveCount())
    },
)

func init() {
    prometheus.MustRegister(liveTimersGauge)
}
```

Graph this against goroutines and live objects, and you have a three-dimensional view of leakiness.

### Per-call-site counters

A more advanced version of the wrapper attributes counts to specific call sites:

```go
package timed

import (
    "runtime"
    "sync"
    "sync/atomic"
    "time"
)

type siteCounter struct {
    count int64
    name  string
}

var (
    siteMu sync.RWMutex
    sites  = map[uintptr]*siteCounter{}
)

func caller(skip int) (uintptr, string) {
    pcs := make([]uintptr, 1)
    n := runtime.Callers(skip+2, pcs)
    if n == 0 {
        return 0, "unknown"
    }
    f, _ := runtime.CallersFrames(pcs).Next()
    return pcs[0], f.Function
}

func incrSite() *siteCounter {
    pc, name := caller(1)
    siteMu.RLock()
    sc, ok := sites[pc]
    siteMu.RUnlock()
    if !ok {
        siteMu.Lock()
        sc, ok = sites[pc]
        if !ok {
            sc = &siteCounter{name: name}
            sites[pc] = sc
        }
        siteMu.Unlock()
    }
    atomic.AddInt64(&sc.count, 1)
    return sc
}

// ... NewTimer, etc., call incrSite() and store sc in the Timer
```

This is more expensive (`runtime.Callers` is not free) but yields a per-call-site live count that maps directly to source lines. In production, this kind of attribution lets you spot the leaking call site in seconds.

---

## Goleak in CI

[`go.uber.org/goleak`](https://github.com/uber-go/goleak) is the standard tool for detecting goroutine leaks in tests. It works by snapshotting the set of goroutines at the start of a test and asserting that no extras remain at the end. While goleak doesn't directly detect timer leaks, it catches the *goroutine* component of paired leaks and is therefore a strong line of defence.

### Basic usage

```go
package mypkg_test

import (
    "testing"

    "go.uber.org/goleak"
)

func TestMain(m *testing.M) {
    goleak.VerifyTestMain(m)
}
```

This adds a check after every test that no goroutines were left behind. If a test creates a goroutine that loops on `time.After` and forgets to shut it down, goleak fails the test with a stack dump.

### Per-test usage

For finer control:

```go
func TestSomething(t *testing.T) {
    defer goleak.VerifyNone(t)
    // ... test body ...
}
```

`VerifyNone` runs at defer time and reports any goroutines that survived the test body.

### Ignoring known goroutines

Some packages (e.g., HTTP clients, OpenTelemetry exporters) intentionally keep background goroutines alive. Use `IgnoreTopFunction` to whitelist them:

```go
goleak.VerifyTestMain(m,
    goleak.IgnoreTopFunction("internal/poll.runtime_pollWait"),
    goleak.IgnoreTopFunction("go.opencensus.io/stats/view.(*worker).start"),
)
```

Be conservative with ignores; every entry is a place a future leak can hide.

### Why goleak doesn't catch pure timer leaks

If your leak is `time.AfterFunc(5*time.Minute, f)` with no goroutine attached, goleak misses it. The leaked timer holds a closure reference but produces no live goroutine until it fires. To catch this in tests you need a *timer* counter:

```go
func TestNoTimerLeaks(t *testing.T) {
    before := timed.LiveCount()
    // ... test body ...
    if after := timed.LiveCount(); after > before {
        t.Fatalf("timer leak: %d timers outstanding", after-before)
    }
}
```

This works if your test exclusively uses the `timed` wrapper. For a mixed codebase, you can sample `pprof.Lookup("heap")` and assert no growth in `time.NewTimer` allocations — but this is fragile because pprof samples.

### CI integration patterns

A typical CI pipeline for a Go service:

```yaml
# .github/workflows/test.yml
- run: go test -race ./...           # races + goleak
- run: go test -tags=timerleak ./... # extra timer checks
- run: staticcheck ./...
- run: vet ./...
- run: ./bin/banafter ./...          # custom analyzer
```

The `timerleak` build tag opts into stricter checks (like the per-test timer counter above), which can be too noisy for every test but invaluable as a separate guard.

### Goleak and test parallelism

Goleak's `VerifyNone` interacts poorly with `t.Parallel()` because parallel tests share goroutines. The standard pattern is:

1. Use `VerifyTestMain` for whole-package checks.
2. Avoid `t.Parallel()` in tests that spawn goroutines you want to verify.

For services where parallel testing is essential, you can spawn goroutines under a context that's cancelled at end of test and `Wait` for them via a `WaitGroup`. This is a more disciplined pattern anyway and removes the need for goleak verification per test.

---

## Building a Leak Reproducer

Before deploying a fix, build a reproducer. A reproducer is a tiny self-contained program that exhibits the same leak signature as production, runs in seconds, and is small enough to step through with a debugger. It is the foundation for everything downstream: regression tests, benchmarks, and confidence in the fix.

### Anatomy of a reproducer

A typical timer-leak reproducer has three parts:

1. A hot loop that exercises the suspected leak pattern.
2. A periodic check of timer count or heap size.
3. Termination on success (leak detected) or timeout (no leak in N seconds).

Here is a reproducer for the canonical `time.After` in a select:

```go
package main

import (
    "context"
    "fmt"
    "runtime"
    "time"
)

func main() {
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()

    workCh := make(chan int, 1)
    done := make(chan struct{})

    // Worker that "races" timer against channel; channel always wins.
    go func() {
        defer close(done)
        for i := 0; i < 1_000_000; i++ {
            workCh <- i
            select {
            case <-workCh:
                // got it, fast path
            case <-time.After(10 * time.Second):
                fmt.Println("slow path")
            }
            if ctx.Err() != nil {
                return
            }
        }
    }()

    // Sampler
    var ms runtime.MemStats
    var lastHeap uint64
    t := time.NewTicker(500 * time.Millisecond)
    defer t.Stop()
    for i := 0; i < 20; i++ {
        <-t.C
        runtime.ReadMemStats(&ms)
        if i > 0 {
            growth := int64(ms.HeapAlloc) - int64(lastHeap)
            fmt.Printf("heap=%d Δ=%+d goroutines=%d\n",
                ms.HeapAlloc, growth, runtime.NumGoroutine())
        }
        lastHeap = ms.HeapAlloc
    }
    cancel()
    <-done
}
```

Run this on Go 1.21:

```
heap=1.2MB Δ=+50KB  goroutines=3
heap=2.5MB Δ=+1.3MB goroutines=3
heap=3.8MB Δ=+1.3MB goroutines=3
...
```

The heap grows about 1.3 MB every 500 ms, which is roughly 130 K timers/s × 200 bytes each. On Go 1.23 the growth is much smaller because the runtime collects unreferenced timers more aggressively — but rerunning the reproducer with `GOGC=off` makes the leak visible on any version.

### Reproducer as a regression test

Once the leak is fixed, the reproducer becomes a test:

```go
// +build !short

package mypkg_test

import (
    "context"
    "runtime"
    "testing"
    "time"
)

func TestNoTimerLeakInHotPath(t *testing.T) {
    if testing.Short() {
        t.Skip("long-running leak test")
    }
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()

    var before, after runtime.MemStats
    runtime.GC()
    runtime.ReadMemStats(&before)

    hotPath(ctx, 100_000)

    runtime.GC()
    runtime.ReadMemStats(&after)

    growth := int64(after.HeapAlloc) - int64(before.HeapAlloc)
    if growth > 1_000_000 { // 1 MB tolerance
        t.Fatalf("hot path leaked %d bytes", growth)
    }
}
```

This kind of test is slow (it usually needs >1 second to run) and is best placed behind a build tag or run only in CI.

### Reproducing in a sandbox

Sometimes the leak is sensitive to scheduling or to specific runtime tunables. A useful debugging mode:

```sh
GODEBUG=gctrace=1,schedtrace=1000 GOGC=10 ./repro
```

`gctrace=1` prints every GC cycle; `schedtrace=1000` prints scheduler statistics every second; `GOGC=10` runs GC aggressively so leaks show up faster. The `schedtrace` output includes counts of P-local timer queues, which is the closest you get to a built-in timer count metric.

### Programmatic timer count

A useful diagnostic in reproducers is to extract the runtime's view of the timer heap. This is not exposed publicly, but it can be approximated via metrics:

```go
import "runtime/metrics"

samples := []metrics.Sample{
    {Name: "/sched/goroutines:goroutines"},
    {Name: "/gc/heap/objects:objects"},
}
metrics.Read(samples)
fmt.Printf("goroutines=%v objects=%v\n",
    samples[0].Value.Uint64(), samples[1].Value.Uint64())
```

Object growth without goroutine growth is a strong signal of timer-style leaks.

### Stress test reproducer

For load-style reproducers:

```go
package main

import (
    "context"
    "runtime"
    "sync"
    "time"
)

func main() {
    ctx, cancel := context.WithCancel(context.Background())

    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for ctx.Err() == nil {
                select {
                case <-time.After(time.Hour):
                case <-ctx.Done():
                    return
                }
            }
        }()
    }

    // Let leaks accumulate
    time.Sleep(30 * time.Second)

    var ms runtime.MemStats
    runtime.ReadMemStats(&ms)
    println("heap=", ms.HeapAlloc)

    cancel()
    wg.Wait()
}
```

100 goroutines, each parked on `time.After(time.Hour)`. After 30 seconds of running, the heap is ~50 MB. Each goroutine has *one* outstanding timer; the leak is paired with a goroutine leak. This is a simple but realistic reproducer.

---

## Real Incident: The `time.After` RPC Loop

This section is the first of six incident reports drawn from real-world postmortems. Names, services, and exact numbers have been generalized; the patterns are the durable lesson.

### Context

A photo-sharing service operated a Go-based RPC gateway that proxied requests from mobile clients to dozens of internal services. The gateway maintained a pool of long-lived RPC connections, each with a worker goroutine that read responses off the socket. Code, simplified:

```go
func (c *Conn) readLoop(ctx context.Context) {
    for {
        select {
        case msg := <-c.incoming:
            c.dispatch(msg)
        case <-time.After(30 * time.Second):
            c.keepalive()
        case <-ctx.Done():
            return
        }
    }
}
```

This ran on Go 1.20.

### Symptoms

Three days after a feature deploy that doubled the gateway's RPC fanout, oncall began receiving alerts: heap usage on gateway pods was climbing steadily, latency p99 was creeping up, and several pods OOM-killed in a 24-hour window. Restarting the pods restored healthy heap, then the climb began again.

### Investigation

Heap dumps taken pre-restart showed `time.NewTimer` as the top allocator (87% of live objects). Goroutine profiles were unremarkable — the gateway maintained roughly 5,000 connection workers, which matched expectations. So the leak was not in goroutines: it was in timers.

The trace of `c.dispatch` revealed the root cause: under the new fanout, `c.incoming` rarely went idle for more than a few milliseconds. Each iteration of the `readLoop` was creating a fresh `time.After(30 * time.Second)` timer, getting a message off the channel, and looping. The timer never fired and was never stopped — but the runtime retained it for 30 seconds. With ~5,000 connections each iterating thousands of times per second, the per-connection timer count grew to 150,000+ timers each. Total live timers: ~750 M. At ~200 bytes each, that's ~150 GiB — the gateway could not even allocate that much; it was OOM-killed long before reaching it.

### Fix

Replace `time.After` with a long-lived `time.Timer` that is stopped and restarted each iteration:

```go
func (c *Conn) readLoop(ctx context.Context) {
    t := time.NewTimer(30 * time.Second)
    defer t.Stop()
    for {
        if !t.Stop() {
            select {
            case <-t.C:
            default:
            }
        }
        t.Reset(30 * time.Second)
        select {
        case msg := <-c.incoming:
            c.dispatch(msg)
        case <-t.C:
            c.keepalive()
        case <-ctx.Done():
            return
        }
    }
}
```

After the fix, the live timer count per goroutine returned to 1 (the long-lived timer) and the heap stabilized.

### Lessons

1. `time.After` in a hot loop is a leak unless the loop iteration is rare. "Rare" here means "less often than the timer's duration."
2. Heap profiles are the right first step. Goroutine profiles were misleading because the actual symptom was timers, not goroutines.
3. The post-1.23 runtime would have mitigated this leak considerably, but not eliminated it: the timers were still allocated and still occupied the timer heap for up to 30 seconds. The leak would have been slower, not absent.
4. A linter that flagged `time.After` in a function loop would have caught this in code review.

### Postmortem note: detection lag

The leak deployed on day 0; the alert fired on day 3; the fix shipped on day 5. The deployment that introduced the leak doubled the gateway's request rate, which doubled the number of iterations through the leaky loop, which doubled the rate of leaked timers. Without that capacity change, the leak would have remained subclinical for weeks. Many timer leaks are like this: they exist in code for months, dormant, and surface only when traffic patterns shift.

---

## Real Incident: The Forgotten `Reset`

### Context

A payment processor used a `time.Timer` as a watchdog for long-running operations. The watchdog reset itself on each progress signal; if it fired, it aborted the operation.

```go
func process(ctx context.Context, op *Op) error {
    watchdog := time.NewTimer(5 * time.Second)
    defer watchdog.Stop()

    progress := op.Progress()
    for {
        select {
        case <-progress:
            watchdog.Reset(5 * time.Second) // bug?
        case <-watchdog.C:
            return ErrTimeout
        case <-ctx.Done():
            return ctx.Err()
        }
    }
}
```

The intended behaviour: each progress signal resets the watchdog. If 5 seconds pass without progress, abort.

### Symptoms

A small but growing fraction of operations were aborting with `ErrTimeout`, even when they were clearly making progress (other instrumentation confirmed it). The error rate grew over time, suggesting drift rather than a workload change.

### Investigation

`Reset` on a `time.Timer` has subtle semantics. From the Go documentation (Go 1.22 and earlier):

> Reset should be invoked only on stopped or expired timers with drained channels.

The bug: when `progress` arrived *after* the watchdog had already fired (but before its channel was drained), calling `Reset` did not actually re-arm the timer. Instead, the old fired-but-unread tick was now ready on the channel, and the next iteration's `select` picked it up and aborted.

This race was rare — it required the watchdog to fire in the very narrow window between the progress signal arriving and the `Reset` call. But it happened often enough that, over the lifetime of a long-running batch, a few percent of operations hit it.

### Fix

Drain the channel before `Reset`:

```go
case <-progress:
    if !watchdog.Stop() {
        select {
        case <-watchdog.C:
        default:
        }
    }
    watchdog.Reset(5 * time.Second)
```

Or, for cleaner code, use `context.WithTimeout` and refactor to use cancellation rather than timer reset.

### Lessons

1. `Reset` is not idempotent and not race-free. The standard pattern is `Stop`, drain, `Reset`.
2. Subtle timer bugs often hide behind correctness bugs (e.g., spurious timeouts) rather than memory leaks. They are part of the same family of mistakes.
3. As of Go 1.23, `Reset` on a fired-but-unread timer behaves more sensibly: the prior tick is discarded. But your code must still work correctly on pre-1.23 runtimes if you support them.

### Detection plan

The bug above is a *correctness* bug, not a leak; we include it because the runtime mechanics are identical. The same wrapper that counts live timers can be enhanced to log timer state transitions, which makes Reset/Stop race conditions easier to diagnose:

```go
func (t *Timer) Reset(d time.Duration) bool {
    prev := atomic.LoadInt32(&t.state)
    log.Printf("reset prev=%d", prev)
    return t.Timer.Reset(d)
}
```

Counting how often `Reset` is called on a not-fully-drained timer gives you a metric for code paths that may have this race.

---

## Real Incident: The Cancelled `context.Context` That Wasn't

### Context

A microservice used `context.WithTimeout` to bound outbound HTTP calls:

```go
func (c *Client) Fetch(parent context.Context, url string) ([]byte, error) {
    ctx, cancel := context.WithTimeout(parent, 30*time.Second)
    defer cancel()
    req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
    resp, err := c.do.Do(req)
    if err != nil {
        return nil, err
    }
    defer resp.Body.Close()
    return io.ReadAll(resp.Body)
}
```

This looks correct. `defer cancel()` ensures the timer behind the context is stopped when the function returns. So far, so safe.

But the production code looked slightly different:

```go
func (c *Client) Fetch(parent context.Context, url string) ([]byte, error) {
    ctx, _ := context.WithTimeout(parent, 30*time.Second) // bug: discarded cancel
    req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
    resp, err := c.do.Do(req)
    if err != nil {
        return nil, err
    }
    defer resp.Body.Close()
    return io.ReadAll(resp.Body)
}
```

The `cancel` function was thrown away.

### Symptoms

The service's heap grew slowly — about 10 MB/day. Pods were restarted weekly and the issue had never been investigated; it was filed as "expected slow growth."

When the team finally took a heap profile, `context.WithTimeout`'s internal timer creation showed up at 35% of live objects. Each call to `Fetch` leaked one timer for up to 30 seconds (the timeout duration) — but because requests took on average <500 ms, the timers far outlived their actual usefulness.

### Investigation

`context.WithTimeout` returns a `(ctx, cancel func())` pair. The `cancel` function not only marks the context as cancelled but also calls `Stop` on the underlying timer. If you don't call `cancel`, the timer is not stopped, and it sits in the runtime timer heap until its duration elapses.

Go's `go vet` has a check called `lostcancel` that catches exactly this mistake — but in this codebase, `vet` had been disabled in CI years ago because of a misleading false positive that the team never got around to fixing. The leak was invisible to all the regular guards.

### Fix

Restore the `cancel` call:

```go
ctx, cancel := context.WithTimeout(parent, 30*time.Second)
defer cancel()
```

And re-enable `go vet` in CI, including the `-lostcancel` check.

### Lessons

1. `context.WithTimeout` (and `WithDeadline`) creates a timer. Discarding the cancel function leaks it.
2. Go vet's `lostcancel` analyzer catches this; it is enabled by default and should never be disabled.
3. Per-request leaks scale with QPS. A service doing 1,000 RPS that leaks one timer per request for 30 seconds keeps 30,000 leaked timers live continuously. At 200 bytes each, that's ~6 MB — small enough to hide.
4. The standard idiom in code review is "`WithTimeout` should always be followed by `defer cancel()`." Train your reviewers, and document the rule.

### Detection plan

Beyond `go vet`, two additional defences:

1. A custom analyzer that flags any call to `context.WithTimeout`, `context.WithDeadline`, or `context.WithCancel` whose second return value is `_`. This is stricter than `lostcancel` because it triggers even when the analyzer cannot prove a leak.

```go
// Pseudocode for the analyzer logic.
if assign, ok := node.(*ast.AssignStmt); ok {
    if len(assign.Lhs) == 2 {
        if id, ok := assign.Lhs[1].(*ast.Ident); ok && id.Name == "_" {
            // Check Rhs is context.WithTimeout/WithDeadline/WithCancel
        }
    }
}
```

2. A wrapper around `context.WithTimeout` in your code base that mandatorily registers a finalizer or logs the cancel function's stack:

```go
package contextx

import (
    "context"
    "runtime"
    "time"
)

func WithTimeout(parent context.Context, d time.Duration) (context.Context, context.CancelFunc) {
    ctx, cancel := context.WithTimeout(parent, d)
    pc, file, line, _ := runtime.Caller(1)
    timersLeakCounter.WithLabelValues(callerName(pc), file, line).Inc()
    return ctx, func() {
        timersLeakCounter.WithLabelValues(callerName(pc), file, line).Dec()
        cancel()
    }
}
```

This gives per-call-site leakage metrics. Any growing counter is a code path that doesn't call cancel.

---

## Real Incident: The `Ticker` Inside a Hot Path

### Context

A service exported per-request metrics. The metrics path created a `time.Ticker` to periodically flush buffered metric samples to a remote collector.

```go
func (m *Metrics) Record(name string, v float64) {
    if m.lastFlush.IsZero() {
        m.startFlusher()
    }
    m.buf = append(m.buf, sample{name, v, time.Now()})
}

func (m *Metrics) startFlusher() {
    t := time.NewTicker(1 * time.Second)
    go func() {
        for range t.C {
            m.flush()
        }
    }()
    m.lastFlush = time.Now()
}
```

The author's intent: start the flusher exactly once. The bug: `Record` was called concurrently from many goroutines, and the `lastFlush.IsZero()` check was not synchronized. Multiple goroutines passed the check simultaneously and started multiple flushers.

### Symptoms

After about 15 minutes of uptime, the service's metrics path started failing because the remote collector rejected duplicate samples. The flusher count grew unboundedly: roughly 30 new flushers per second once traffic ramped up.

Each flusher was a goroutine + a ticker + a 1-second-period buffer flush. The leak was therefore *all three*: goroutines, timers (one per ticker), and CPU (the flushers competed for the lock on `m.buf`).

### Investigation

The goroutine profile was unambiguous:

```
goroutine profile: total 50032
   49998 @ ...
#   0x73a200   main.(*Metrics).startFlusher.func1+0x40 /app/metrics.go:21
```

50,000 goroutines, all of them flushers. Heap profile showed `time.NewTicker` at the top of live objects, confirming the paired timer leak.

### Fix

Make the start-once check atomic:

```go
type Metrics struct {
    once sync.Once
    // ...
}

func (m *Metrics) Record(name string, v float64) {
    m.once.Do(m.startFlusher)
    // ...
}
```

After the fix, exactly one flusher ran per `Metrics` instance.

### Lessons

1. `sync.Once` is the standard tool for "exactly once" initialization. Don't roll your own with a flag.
2. A double-init bug is doubly bad when the init creates a timer: you now leak both a goroutine and a timer, compounding the cost.
3. A `Ticker` is a long-lived timer. Leaking one is more expensive than leaking a one-shot `Timer` because the ticker persists until `Stop` (which the leaked goroutine never calls).
4. The fix to this leak required a heap profile *and* a goroutine profile. Neither alone would have been enough: heap profile shows the timer leak but not the goroutine count; goroutine profile shows the goroutines but not the timers. Always look at both.

### Detection plan

The single best detection for this kind of bug is `goleak` in CI. A unit test that records metrics, finishes, and runs `goleak.VerifyNone(t)` would have failed instantly on the first concurrent run. Goleak's failure message would have included the flusher's stack, pointing the author at `metrics.go:21` immediately.

---

## Real Incident: The Reconnect Loop

### Context

A streaming ingest service used a long-lived TCP connection to a backend message broker. On disconnect, it reconnected with exponential backoff. The relevant code:

```go
func (c *Client) run(ctx context.Context) {
    backoff := 1 * time.Second
    for ctx.Err() == nil {
        if err := c.connect(ctx); err == nil {
            backoff = 1 * time.Second // reset on success
            continue
        }
        select {
        case <-time.After(backoff):
        case <-ctx.Done():
            return
        }
        backoff *= 2
        if backoff > time.Minute {
            backoff = time.Minute
        }
    }
}
```

The leaking call: `time.After(backoff)` inside a `for ... select`. On every reconnect attempt, the timer was allocated; on success path (no select), no timer was needed.

### Symptoms

In a healthy environment with rare disconnects, the leak was invisible — the loop slept for a second, the timer fired, all was well. But during an upstream outage where reconnects happened thousands of times per second (with `backoff` quickly hitting the 1-minute ceiling), the leak accelerated: every reconnect attempt scheduled a 1-minute timer that was rarely consumed before being replaced by the next.

After two hours of upstream brownout, the ingest service consumed 8 GB of memory and OOM-killed. The brownout had been mild (broker was returning 503s, not refusing connections); the side effect was catastrophic.

### Investigation

Heap profile during the brownout:

```
3.2GB time.NewTimer
2.1GB chan Time (timer channels)
0.4GB *time.Timer
0.1GB other
```

99% of heap was timer-related. Live timer count, extracted from the runtime's `schedtrace` output: 8.3 million. With 60-second timeouts and an attempt-rate of ~140 K/s, that math checks: 140,000 × 60 = 8.4 M.

### Fix

```go
func (c *Client) run(ctx context.Context) {
    backoff := 1 * time.Second
    t := time.NewTimer(time.Hour) // initial dummy; will be reset
    if !t.Stop() {
        <-t.C
    }
    defer t.Stop()
    for ctx.Err() == nil {
        if err := c.connect(ctx); err == nil {
            backoff = 1 * time.Second
            continue
        }
        t.Reset(backoff)
        select {
        case <-t.C:
        case <-ctx.Done():
            return
        }
        backoff *= 2
        if backoff > time.Minute {
            backoff = time.Minute
        }
    }
}
```

Reuse a single timer. The leak is gone.

### Lessons

1. A *reconnect* loop is a hot loop during incidents. Even if you assume reconnects are rare in steady state, allocate as if they could be common, because during incidents they will be.
2. Leak symptoms can be triggered by upstream brownouts. The leaky code is in *your* service, but the workload that exposes it comes from elsewhere. Test with chaos-engineering scenarios that simulate flapping upstreams.
3. Connection management code is one of the most leak-prone patterns in Go. Always allocate timers outside loops, always defer-stop, always reuse via `Reset`.

### Detection plan

This service did not have per-timer-call-site metrics. After the incident, the team added:

1. A `live_timers_per_site` gauge using the per-call-site wrapper described earlier.
2. A chaos test that flapped the upstream broker every 30 seconds for an hour and asserted that the ingest service's heap remained bounded.

Both would have caught the bug pre-deploy.

---

## Real Incident: The Per-Request Health Check

### Context

An API gateway performed an upstream health check before forwarding each request. The check used `time.AfterFunc` to schedule a fallback action if the upstream took too long:

```go
func (g *Gateway) Forward(ctx context.Context, req *Request) (*Response, error) {
    fallback := time.AfterFunc(2*time.Second, func() {
        g.recordSlowUpstream(req.upstream)
    })
    resp, err := g.upstream.Call(ctx, req)
    // bug: fallback is never stopped
    return resp, err
}
```

If the upstream responded in <2 seconds (the common case), the `fallback` function ran needlessly 2 seconds after the response. The bug was both a correctness issue (spurious "slow upstream" metrics) and a leak: the `*Timer` was retained for the full 2 seconds.

### Symptoms

The "slow upstream" metric was massively inflated. The team initially thought their upstream was misbehaving; only after weeks of escalating with the upstream team did someone notice that the slow-count exactly equalled the request-count.

The leak component was less prominent but real: at 5,000 RPS, the service held ~10,000 unnecessary `*Timer` allocations continuously (2 s × 5,000/s).

### Fix

```go
func (g *Gateway) Forward(ctx context.Context, req *Request) (*Response, error) {
    fallback := time.AfterFunc(2*time.Second, func() {
        g.recordSlowUpstream(req.upstream)
    })
    defer fallback.Stop()
    resp, err := g.upstream.Call(ctx, req)
    return resp, err
}
```

A single `defer fallback.Stop()` fixed both the correctness bug and the leak.

### Lessons

1. `time.AfterFunc` returns a `*Timer`. The return value exists precisely so you can stop it. If you discard it, you have signed up for leaking the timer for the full duration.
2. A pattern: any `time.AfterFunc` whose return value is `_` is suspicious. A linter that flags this would have caught the bug.
3. The leak component was small relative to the correctness component, but both came from the same root cause. Often a "small leak" is symptom of an undetected correctness bug. Investigate, don't dismiss.

### Detection plan

```go
// Pseudocode for a custom analyzer.
if call, ok := node.(*ast.CallExpr); ok {
    if sel, ok := call.Fun.(*ast.SelectorExpr); ok {
        if pkg, ok := sel.X.(*ast.Ident); ok && pkg.Name == "time" &&
            sel.Sel.Name == "AfterFunc" {
            // Check that the enclosing statement is not an assignment
            // (i.e., the return value is discarded)
        }
    }
}
```

Couple this with the timer-count metric and you have both prevention and detection.

---

## Postmortem Template for Timer Leaks

Every leak fixed in production should produce a postmortem. The postmortem's job is not blame; it is to ensure the same shape of leak does not recur, and to populate your team's institutional memory. A timer-leak-specific template:

```
## Postmortem: <service-name> timer leak

### Summary
- One paragraph: what was leaked, when, for how long, what user impact.

### Timeline
- T+0: Deploy of feature X
- T+72h: Alert fired (heap > threshold)
- T+74h: Triage identified time.After in handler.go:42
- T+78h: Patch deployed, leak stopped

### Root cause
- Code snippet of the leaking pattern
- Why it leaked (which API behaviour was misunderstood)
- Which Go version: 1.X.Y

### Why we didn't catch it earlier
- Was vet on? Was staticcheck on? Was goleak on?
- Was there a metric that should have shown it?
- Why didn't the metric alert?

### Impact
- Memory leaked per hour: X MB
- Time to OOM: Y hours
- User-visible impact: Z

### Mitigations
- Code fix (link to PR)
- Detection improvement (new metric / new alert / new linter)
- Documentation update

### Open follow-ups
- [ ] Audit other handlers for same pattern
- [ ] Add lint rule for X
- [ ] Add chaos test for Y
```

The discipline is: do not close a timer-leak postmortem without filling in *both* "why we didn't catch it earlier" and "detection improvement." Every recurrence is a process failure as well as a code failure.

### Linking postmortems to retrospectives

A timer-leak retrospective should ask:

1. What did this team know about timer pitfalls before the incident?
2. What training / docs / examples could have prevented it?
3. Are there other patterns in the codebase that look similar?

Run `grep -r "time.After" .` in the affected codebase after every leak. If the count is large, the leak is structural and you need a campaign, not a patch.

---

## Retrofitting Old Codebases

You have inherited (or you wrote, years ago) a Go codebase with hundreds of uses of `time.After`. You suspect leaks but cannot prove them. How do you retrofit safely?

### Phase one: instrument

Add the metric layer first. Specifically:

1. Export `go_live_objects`, `go_goroutines`, `go_heap_alloc`, `go_gc_cycles` as standard runtime metrics.
2. Deploy.
3. Wait one week for baseline data.

You now have a chart of object growth over time, and you can pinpoint which deploys cause growth shifts.

### Phase two: profile

For each suspect service:

1. Snapshot a heap profile during normal traffic.
2. Snapshot another heap profile 24 hours later.
3. Diff them. Identify the top growing allocation site.

If `time.NewTimer` is at the top, you have your leak. If not, the leak is elsewhere — fix that one first, then revisit timers.

### Phase three: audit

Run `grep -rn "time.After" .` and `grep -rn "time.NewTicker" .` and `grep -rn "time.AfterFunc" .` on the codebase. Categorize each match:

| Category | Action |
|---|---|
| `time.After` in a function body, not in a loop | Probably fine; review case-by-case |
| `time.After` in a `for` loop or `select` inside a loop | Suspect; fix to use reusable timer |
| `time.NewTicker` outside a goroutine | Audit for missing `Stop` |
| `time.AfterFunc(...)` where return is `_` | Suspect; verify timer doesn't need cancelling |
| `context.WithTimeout(...)` where cancel is `_` | Always a leak; fix |

You will likely find that 5–20% of matches are real leaks. The rest are fine but suspicious. Fix the leaks first, then file follow-ups to make the suspicious ones idiomatic.

### Phase four: enforce

After the leaks are fixed, add prevention:

1. Enable `go vet -lostcancel` (default on, but verify).
2. Enable `staticcheck` with check `SA4006` (unused values).
3. Add a custom analyzer that forbids `time.After` in any function with a loop. Or, less aggressively, that requires an explicit `// timer-allowed` comment to use `time.After` in a loop.
4. Add `goleak.VerifyTestMain` to every package's test.

### Phase five: telemetry

Now add the live-timer counter:

1. Build the `timed` wrapper package.
2. Migrate one service to use the wrapper exclusively.
3. Deploy with the new metric (`go_live_timers`).
4. Set alerting on metric drift.

You now have a dashboard that shows timer count per pod, and an alert that fires on positive slope over a 6-hour window. Future leaks will be caught within hours instead of days.

### Phase six: training

Document the rules. Add a wiki page titled "Time-related code in this codebase" that lists:

- Which APIs are forbidden (`time.After` in loops)
- Which APIs are mandatory (`defer cancel()` after `context.WithTimeout`)
- Which wrappers are available (`timed.NewTimer`, etc.)
- Which linters enforce these rules

Make this page part of new-hire orientation. The cost of writing the page is small; the cost of an incident from a new engineer's first PR is large.

### Estimating fix cost

For a typical mid-size Go codebase (50 K LOC, 100+ uses of `time.After`):

- Phase 1 (instrument): 2 days
- Phase 2 (profile): 1 day per service
- Phase 3 (audit): 3–5 days
- Phase 4 (enforce): 2 days
- Phase 5 (telemetry): 5 days
- Phase 6 (training): 1 day

Total: roughly 2–3 weeks of one engineer's time, depending on the breadth of suspect call sites. The payoff is a permanent reduction in time-related leak incidents.

---

## Static Analysis: `vet`, `staticcheck`, Custom Analyzers

A line of defence that runs at PR time catches leaks before they ship. Three tools matter.

### `go vet`

Built into the Go toolchain. Run it on every CI build. For timer leaks specifically:

- `-lostcancel`: detects calls to `context.WithCancel`, `WithDeadline`, and `WithTimeout` where the returned `cancel` function is not called on all paths. Catches the "ignored cancel" leak from incident three.

A `vet` failure should fail the build. Period.

### `staticcheck`

A third-party but widely-used analyzer with much broader coverage than `vet`. Relevant checks:

- `SA1018`: reports incorrect usage of `time.Tick` in non-program-lifetime contexts.
- `SA1019`: reports use of deprecated APIs (catches `time.Tick` in some configurations).
- `SA4006`: reports unused values; catches `_ = time.AfterFunc(...)` style assignments that throw away the cancellable timer.

Integrate into CI:

```sh
go install honnef.co/go/tools/cmd/staticcheck@latest
staticcheck -checks "all,-ST1000,-ST1003" ./...
```

### Custom analyzers via `go/analysis`

For project-specific rules, write your own analyzer using the `go/analysis` framework. Two examples already appeared in this document; here is a fuller specification.

**Rule: ban `time.After` in any `for` body**

```go
package banafterloop

import (
    "go/ast"
    "go/token"
    "golang.org/x/tools/go/analysis"
)

var Analyzer = &analysis.Analyzer{
    Name: "banafterloop",
    Doc:  "Forbid time.After inside for-loop bodies",
    Run:  run,
}

func run(pass *analysis.Pass) (interface{}, error) {
    for _, file := range pass.Files {
        ast.Inspect(file, func(n ast.Node) bool {
            forStmt, ok := n.(*ast.ForStmt)
            if !ok {
                return true
            }
            ast.Inspect(forStmt.Body, func(inner ast.Node) bool {
                call, ok := inner.(*ast.CallExpr)
                if !ok {
                    return true
                }
                sel, ok := call.Fun.(*ast.SelectorExpr)
                if !ok {
                    return true
                }
                if pkg, ok := sel.X.(*ast.Ident); ok &&
                    pkg.Name == "time" && sel.Sel.Name == "After" {
                    pass.Reportf(call.Pos(), "time.After in for-loop body")
                }
                return true
            })
            return true
        })
    }
    return nil, nil
}
```

**Rule: require `defer cancel()` after `context.WithTimeout`**

```go
package mustcancel

import (
    "go/ast"
    "go/token"
    "go/types"
    "golang.org/x/tools/go/analysis"
)

var Analyzer = &analysis.Analyzer{
    Name: "mustcancel",
    Doc:  "Require defer cancel() after context.WithTimeout",
    Run:  run,
}

func run(pass *analysis.Pass) (interface{}, error) {
    for _, file := range pass.Files {
        ast.Inspect(file, func(n ast.Node) bool {
            assign, ok := n.(*ast.AssignStmt)
            if !ok || len(assign.Lhs) != 2 {
                return true
            }
            call, ok := assign.Rhs[0].(*ast.CallExpr)
            if !ok {
                return true
            }
            sel, ok := call.Fun.(*ast.SelectorExpr)
            if !ok {
                return true
            }
            if pkg, ok := sel.X.(*ast.Ident); ok &&
                pkg.Name == "context" &&
                (sel.Sel.Name == "WithTimeout" || sel.Sel.Name == "WithDeadline") {
                cancelName := ""
                if id, ok := assign.Lhs[1].(*ast.Ident); ok {
                    cancelName = id.Name
                }
                if cancelName == "_" {
                    pass.Reportf(assign.Pos(),
                        "context.%s cancel result discarded", sel.Sel.Name)
                }
                _ = types.Universe
                _ = token.NoPos
            }
            return true
        })
    }
    return nil, nil
}
```

These analyzers can be integrated as part of a custom linter binary or as plugins for `golangci-lint`. The investment pays off: each rule prevents an entire class of bug.

### Running analyzers in CI

`golangci-lint` is the standard runner. Configure it via `.golangci.yml`:

```yaml
linters:
  enable:
    - govet
    - staticcheck
    - errcheck
    - unused
    - banafterloop  # custom
    - mustcancel    # custom

linters-settings:
  govet:
    enable:
      - lostcancel
```

Fail the build on any error. Bypass requires explicit `//nolint:banafterloop` comments, which show up in code review.

### False positives

Every analyzer produces false positives in edge cases. Document the acceptable bypass mechanism:

```go
//nolint:banafterloop // single-iteration loop, not a leak
for {
    select {
    case <-c.shutdown:
        return
    case <-time.After(5 * time.Second):
        c.flush()
    }
}
```

Note: this example is actually still leaky in pre-1.23 — the timer leaks on every shutdown signal. The reviewer who accepted this bypass should have caught it. Bypasses are tools, not exemptions; they require justification in the comment.

---

## Wrappers That Make Misuse Hard

Beyond linters, the most reliable way to prevent timer leaks is to make the leaky API hard to access. The `timed` wrapper above is a start; here we extend it to handle additional patterns.

### Bounded `Sleep`

A common pattern is "sleep for d, but wake up on cancel":

```go
select {
case <-time.After(d):
case <-ctx.Done():
}
```

This leaks the timer for up to `d` if `ctx` is cancelled first. The wrapped equivalent:

```go
// Sleep blocks for d or until ctx is done. The underlying timer is
// always stopped, so this is leak-free.
func Sleep(ctx context.Context, d time.Duration) error {
    t := time.NewTimer(d)
    defer t.Stop()
    select {
    case <-t.C:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

Once `Sleep` is available, code reviews can require it instead of bare `time.After`. The wrapper has a tiny allocation cost (one timer per call) but is always leak-free.

### `AfterCtx`

```go
// AfterCtx returns a channel that delivers once d has elapsed or ctx is done.
// The returned cancel function must be called to release resources.
func AfterCtx(ctx context.Context, d time.Duration) (<-chan time.Time, func()) {
    ch := make(chan time.Time, 1)
    t := time.AfterFunc(d, func() {
        select {
        case ch <- time.Now():
        default:
        }
    })
    cancel := func() {
        t.Stop()
    }
    go func() {
        select {
        case <-ctx.Done():
            t.Stop()
        case <-time.After(d + 100*time.Millisecond):
        }
    }()
    return ch, cancel
}
```

This is more complex; some teams find it overengineered. The simpler `Sleep` covers most cases. Provide both and let the codebase pick the lightest fit.

### `Backoff`

A common reconnect pattern abstracted into a leak-free helper:

```go
type Backoff struct {
    Min, Max time.Duration
    Factor   float64
    cur      time.Duration
    timer    *time.Timer
}

func NewBackoff(min, max time.Duration) *Backoff {
    return &Backoff{Min: min, Max: max, Factor: 2.0, cur: min}
}

// Wait blocks for the current backoff duration or until ctx is done.
func (b *Backoff) Wait(ctx context.Context) error {
    if b.timer == nil {
        b.timer = time.NewTimer(b.cur)
    } else {
        if !b.timer.Stop() {
            select {
            case <-b.timer.C:
            default:
            }
        }
        b.timer.Reset(b.cur)
    }
    select {
    case <-b.timer.C:
    case <-ctx.Done():
        b.timer.Stop()
        return ctx.Err()
    }
    next := time.Duration(float64(b.cur) * b.Factor)
    if next > b.Max {
        next = b.Max
    }
    b.cur = next
    return nil
}

// Reset returns the backoff to its initial duration.
func (b *Backoff) Reset() {
    b.cur = b.Min
}

// Close stops the underlying timer.
func (b *Backoff) Close() {
    if b.timer != nil {
        b.timer.Stop()
    }
}
```

A reconnect loop using this:

```go
b := NewBackoff(100*time.Millisecond, time.Minute)
defer b.Close()
for ctx.Err() == nil {
    if err := connect(); err == nil {
        b.Reset()
        continue
    }
    if err := b.Wait(ctx); err != nil {
        return
    }
}
```

No raw `time.After` in sight. The `Backoff` struct owns exactly one timer for its entire lifetime.

### `Throttle`

For rate-limiting: trigger an action at most once per duration:

```go
type Throttle struct {
    d     time.Duration
    timer *time.Timer
    fired bool
    mu    sync.Mutex
}

func NewThrottle(d time.Duration) *Throttle {
    return &Throttle{d: d}
}

// Do runs f if no other Do call has run in the last d.
func (th *Throttle) Do(f func()) {
    th.mu.Lock()
    defer th.mu.Unlock()
    if th.fired {
        return
    }
    th.fired = true
    f()
    if th.timer == nil {
        th.timer = time.AfterFunc(th.d, func() {
            th.mu.Lock()
            th.fired = false
            th.mu.Unlock()
        })
    } else {
        th.timer.Reset(th.d)
    }
}

func (th *Throttle) Close() {
    th.mu.Lock()
    defer th.mu.Unlock()
    if th.timer != nil {
        th.timer.Stop()
    }
}
```

Compared to a hand-rolled "did I fire in the last second?" check with `time.After`, this owns exactly one timer per `Throttle` instance and is leak-free.

### Adoption strategy

Wrappers only help if everyone uses them. Adoption is harder than implementation. Strategies that work:

1. **Codebase-wide grep on PR**: any PR that adds `time.After`, `time.NewTimer`, or `time.AfterFunc` raises a checklist item asking the author to consider the wrapper alternative.
2. **Documentation**: a top-level wiki page that says "here are the leak-prone time APIs; here are the wrappers; use the wrappers."
3. **Onboarding**: new engineers see the wrapper APIs first; the raw `time.*` APIs are introduced only with their associated pitfalls.
4. **Code review templates**: the team's PR template includes "any new uses of time.After? If so, why not Sleep?" The question gets asked before approval.

A wrapper that 70% of new code uses is much more valuable than a perfect wrapper that 5% of new code uses. Optimize for adoption.

---

## Capacity Planning and Cost of Timers

Beyond leak detection, you should know what timers cost when used correctly. This shapes your capacity planning and your alerting thresholds.

### Per-timer overhead

On 64-bit Linux with Go 1.21:

| Component | Size |
|---|---|
| `time.Timer` struct | ~120 bytes |
| Internal `runtimeTimer` (embedded) | ~96 bytes |
| `chan time.Time` allocation | ~96 bytes |
| Per-P heap slot | 8 bytes |
| **Total per active timer** | **~220–250 bytes** |

A million live timers therefore cost ~250 MB. This is "normal" for a service handling many concurrent operations, but it's worth knowing the floor.

### CPU cost of timer operations

Microbenchmarks on a typical x86_64 server, Go 1.21:

| Operation | Latency |
|---|---|
| `time.NewTimer(d)` | ~60 ns |
| `t.Stop()` (not fired) | ~30 ns |
| `t.Reset(d)` | ~50 ns |
| Timer fire (runtime → channel send) | ~150 ns |
| `t.C` receive (steady state) | ~25 ns |
| `time.After(d)` (creates + drops) | ~80 ns |

For a service issuing 10,000 timer operations per second, this is roughly 0.6–1.0 ms/s, or 0.06–0.1% of one CPU. Negligible for normal workloads. But for hot paths (e.g., per-message timer in a streaming service), the cost can rise to 1–5% of CPU, at which point it shows up in flame graphs as `runtime.addtimer` and `runtime.deltimer`.

Go 1.23's rewrite is roughly 2–3× faster on most timer operations. A leak-prone service that upgrades to 1.23 will see noticeable CPU reduction; this is one of the better reasons to upgrade.

### Timer heap depth

The per-P timer heap is a min-heap, so insertion, deletion, and find-min are all O(log n). For a P with 10,000 outstanding timers, each operation is roughly 14 comparisons — well under a microsecond. For a P with 1,000,000 outstanding timers, ~20 comparisons. The asymptotic cost is fine; the absolute cost is dominated by memory access patterns at very high depths.

If you discover that a single P has millions of timers (which can happen with timer leaks or with very concurrent services that don't load-balance timer-using goroutines), the GC pause time will be impacted. Each GC cycle must walk the timer heap to mark live timers' channels and closures as reachable.

### GC cost

Every timer's channel is a heap object the GC must visit. Every timer's `AfterFunc` closure (if any) is a heap object the GC must visit. For a service with a million timers, that's a million extra objects in the GC root set's reachable graph. Estimated GC pause increase: 10–50 ms per cycle on a typical x86_64 server.

This is the silent killer of services with timer leaks. The leak doesn't OOM; it just makes every GC pause longer, which manifests as p99 latency drift.

### Practical alerting thresholds

For a typical Go service with the `go_live_timers` metric:

| Threshold | Interpretation |
|---|---|
| < 1,000 | Normal for any service |
| 1,000 – 10,000 | Normal for a busy service with many concurrent operations |
| 10,000 – 100,000 | Worth investigating; check growth rate |
| > 100,000 | Likely a leak |

The most useful alert is on *growth rate*, not absolute count:

```
deriv(go_live_timers[6h]) > 5
```

A live count that grows by 5 per second sustained over 6 hours is leaking 100,000 timers per day. This is a strong signal regardless of the absolute level.

---

## Continuous Profiling in Production

The most advanced detection layer is continuous profiling: shipping a heap profile (and optionally goroutine + cpu profiles) from every pod to a central system on a continuous basis. Tools that do this include [Pyroscope](https://pyroscope.io), [Polar Signals](https://www.polarsignals.com/), [Datadog Continuous Profiler](https://www.datadoghq.com/product/code-profiling/), and the open-source Parca project.

### Why continuous profiling helps timer leaks

The standard `go tool pprof` workflow assumes you have a *suspicion* — you take a profile after the leak is already manifesting. Continuous profiling reverses this: every profile is collected, indexed, and searchable. When a leak appears, you can travel back in time to compare profiles from before and after a deploy, narrowing the regression window to the exact commit.

For timer leaks, the key trick is: search the continuous-profiling history for `time.NewTimer` allocations over the last 30 days, and look for growth correlated with deploys. The platform makes this a single query.

### Pyroscope integration

Pyroscope ships an SDK that runs in your service and periodically uploads profiles:

```go
import "github.com/grafana/pyroscope-go"

func init() {
    pyroscope.Start(pyroscope.Config{
        ApplicationName: "myservice",
        ServerAddress:   "http://pyroscope:4040",
        ProfileTypes: []pyroscope.ProfileType{
            pyroscope.ProfileCPU,
            pyroscope.ProfileAllocObjects,
            pyroscope.ProfileAllocSpace,
            pyroscope.ProfileInuseObjects,
            pyroscope.ProfileInuseSpace,
            pyroscope.ProfileGoroutines,
        },
    })
}
```

This adds a small CPU overhead (1–3%) and a network cost for uploading profiles every minute. In return you get a continuously updated, queryable view of every allocation site in your fleet.

### Querying for timer leaks

In Pyroscope's UI, a typical timer-leak query:

> Show `inuse_objects` for `time.NewTimer` over the last 7 days, grouped by version.

If you see a step change in the count corresponding to a deploy, you have a regression. If you see a gradual upward trend in the count for a specific pod, you have a per-pod leak.

### Cost considerations

Continuous profiling costs:
- 1–3% CPU on every pod
- Network bandwidth: ~1–5 MB/minute per pod for full profiling
- Storage: depends on your tier; typical SaaS pricing is per-instance-hour

For services larger than ~50 pods, the operational cost of continuous profiling is much lower than the cost of even one timer-leak incident. For smaller services, the break-even depends on how often you ship code and how critical the service is.

### Self-hosted Parca

Parca is the open-source continuous profiler maintained by Polar Signals. It uses eBPF for ultra-low-overhead sampling and has a SaaS-compatible UI. For teams that don't want a vendor dependency, Parca is the standard choice.

```sh
parca --config-path=parca.yaml
```

With a config that scrapes your Go services on their pprof endpoints. The result is a multi-week, queryable archive of every profile from every pod.

### When continuous profiling is overkill

A small team with one or two services doesn't need continuous profiling. The cost-benefit favours `pprof` snapshots taken on demand. The threshold to adopt continuous profiling is roughly:

- More than 5 production services
- More than 50 pods total
- More than one timer-leak (or similar) incident per quarter

Below that threshold, on-demand `pprof` is sufficient. Above, continuous profiling pays for itself.

---

## Self-Assessment

If you can answer each of these questions without consulting the document, you have mastered the material. Suggested study time: 1–2 hours of reading, plus building a reproducer yourself.

1. Why are leaked timers not visible in `runtime.Stack` output?
2. Given a service with rising heap, rising goroutines, and `time.NewTimer` at 60% of heap profile, what is the leak's likely root cause?
3. What is the minimum information needed to estimate the per-hour memory cost of a timer leak in a service?
4. Why does `context.WithTimeout` with a discarded cancel function leak a timer? How long is the leak per call?
5. What is the difference between leaking a `time.Timer` and leaking a `time.Ticker`, in terms of cost over time?
6. Write a `timed.Sleep` function that is leak-free under context cancellation.
7. What does `go vet`'s `lostcancel` check detect, and why is it insufficient for catching all timer-related leaks?
8. What does Go 1.23's timer rewrite improve, and what kinds of leaks does it still not catch?
9. What is the difference between an `inuse_objects` and `alloc_objects` heap profile? When would you use each for timer leak debugging?
10. Why does a `time.After` inside a `select` inside a `for` loop with a fast-firing other case leak?
11. Write a custom analyzer (high-level pseudocode) that flags `time.AfterFunc` whose return value is discarded.
12. What metric, if exported and graphed, would have caught the "reconnect loop" incident before its impact?
13. Why is goleak insufficient to catch a pure timer leak (e.g., a leaked `AfterFunc`)?
14. Estimate the GC overhead of 1 million live leaked timers in a Go service.
15. Describe the six-phase retrofitting plan from this document, and which phase is the "permanent fix" vs which are short-term.

---

## Summary

Timer leaks in Go are a class of slow, expensive, and invisible bugs that span concurrent programming and memory management. Their root cause is, almost always, one of three patterns:

1. `time.After` in a hot loop or `select`.
2. A `time.Timer`, `time.Ticker`, or `time.AfterFunc` whose `Stop` is never called.
3. A `context.WithTimeout` or `WithDeadline` whose `cancel` function is discarded.

Detection rests on a stack of layers, each catching leaks at a different scale and cost:

1. `runtime.MemStats` and `runtime/metrics` for steady-state monitoring.
2. `pprof` heap profiles for allocation-site attribution.
3. `pprof` goroutine profiles for goroutine-paired leaks.
4. Execution traces for scheduler-level diagnosis.
5. A custom live-timer counter for direct visibility.
6. `goleak` for CI-time goroutine-leak guards.
7. `vet`, `staticcheck`, and custom analyzers for static-analysis prevention.

Production discipline rests on:

- Wrappers that make the leaky APIs harder to misuse.
- Linters that catch the obvious mistakes.
- Telemetry that surfaces leaks within hours, not weeks.
- A culture of postmortems that turn every leak into a permanent process improvement.

The cost of a timer leak in production is rarely the leak itself: it is the time spent investigating, the credibility cost of an SLO breach, and the engineering hours spent on retrofits. The cost of prevention is small in comparison. Build the prevention infrastructure once, maintain it, and you can carry the risk of `time.After` without the routine surprises.

---

### Appendix A: The `timed` Package, Complete Source

For reference, here is the complete `timed` wrapper package as discussed throughout this document, in a single drop-in form.

```go
// Package timed wraps the standard library's time-based concurrency
// primitives with a live-count metric. It is intended as a drop-in
// replacement for time.NewTimer, time.NewTicker, and time.AfterFunc in
// production code where timer-leak detection is required.
package timed

import (
    "context"
    "runtime"
    "sync"
    "sync/atomic"
    "time"
)

// liveCount is the global count of timers currently outstanding.
var liveCount int64

// LiveCount returns the current number of timers known to be live.
func LiveCount() int64 {
    return atomic.LoadInt64(&liveCount)
}

// Timer wraps a time.Timer with a live count.
type Timer struct {
    *time.Timer
    stopped int32
    site    string
}

// NewTimer creates a new Timer. The returned timer must be Stopped or
// allowed to fire; orphaned timers are leaks.
func NewTimer(d time.Duration) *Timer {
    atomic.AddInt64(&liveCount, 1)
    t := &Timer{
        Timer: time.NewTimer(d),
        site:  callerSite(2),
    }
    return t
}

// Stop stops the timer and decrements the live count exactly once.
func (t *Timer) Stop() bool {
    if atomic.CompareAndSwapInt32(&t.stopped, 0, 1) {
        atomic.AddInt64(&liveCount, -1)
    }
    return t.Timer.Stop()
}

// Reset resets the timer. If the timer was stopped, the live count is
// incremented again.
func (t *Timer) Reset(d time.Duration) bool {
    if atomic.CompareAndSwapInt32(&t.stopped, 1, 0) {
        atomic.AddInt64(&liveCount, 1)
    }
    return t.Timer.Reset(d)
}

// Site returns the source location where this timer was created.
func (t *Timer) Site() string {
    return t.site
}

// Ticker wraps a time.Ticker with a live count.
type Ticker struct {
    *time.Ticker
    stopped int32
    site    string
}

func NewTicker(d time.Duration) *Ticker {
    atomic.AddInt64(&liveCount, 1)
    return &Ticker{
        Ticker: time.NewTicker(d),
        site:   callerSite(2),
    }
}

func (t *Ticker) Stop() {
    if atomic.CompareAndSwapInt32(&t.stopped, 0, 1) {
        atomic.AddInt64(&liveCount, -1)
    }
    t.Ticker.Stop()
}

// AfterFunc schedules f to run after d. The returned Timer can be
// Stopped to cancel f. If not stopped, f will run.
func AfterFunc(d time.Duration, f func()) *Timer {
    atomic.AddInt64(&liveCount, 1)
    t := &Timer{site: callerSite(2)}
    t.Timer = time.AfterFunc(d, func() {
        if atomic.CompareAndSwapInt32(&t.stopped, 0, 1) {
            atomic.AddInt64(&liveCount, -1)
        }
        f()
    })
    return t
}

// Sleep blocks for d or until ctx is done. The underlying timer is
// always stopped, so Sleep is leak-free.
func Sleep(ctx context.Context, d time.Duration) error {
    t := NewTimer(d)
    defer t.Stop()
    select {
    case <-t.C:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}

// After is a leak-free alternative to time.After. It returns a channel
// that delivers once d has elapsed. The caller must call the returned
// cancel function (or wait for the timer to fire) to release resources.
func After(d time.Duration) (<-chan time.Time, func()) {
    t := NewTimer(d)
    return t.C, func() { t.Stop() }
}

func callerSite(skip int) string {
    pcs := make([]uintptr, 1)
    n := runtime.Callers(skip+1, pcs)
    if n == 0 {
        return "unknown"
    }
    frame, _ := runtime.CallersFrames(pcs).Next()
    return frame.Function
}

// PerSiteCounts holds per-call-site live counts.
type PerSiteCounts struct {
    mu    sync.RWMutex
    sites map[string]*int64
}

var perSite = PerSiteCounts{sites: map[string]*int64{}}

// Snapshot returns a copy of the current per-site counts.
func Snapshot() map[string]int64 {
    perSite.mu.RLock()
    defer perSite.mu.RUnlock()
    out := make(map[string]int64, len(perSite.sites))
    for k, v := range perSite.sites {
        out[k] = atomic.LoadInt64(v)
    }
    return out
}
```

This package compiles against any Go 1.18+ runtime and provides the entire stack of count-based detection used in this document.

### Appendix B: Common `golangci-lint` Configuration

A representative `.golangci.yml` for a service that takes timer-leak prevention seriously:

```yaml
run:
  timeout: 5m
  modules-download-mode: readonly

linters:
  disable-all: true
  enable:
    - govet
    - staticcheck
    - errcheck
    - ineffassign
    - unused
    - gosimple
    - typecheck
    - bodyclose
    - rowserrcheck
    - gocritic
    - nakedret
    - prealloc
    - misspell
    - exportloopref
    - noctx

linters-settings:
  govet:
    enable-all: true
  staticcheck:
    checks: ["all"]
  gocritic:
    enabled-tags:
      - performance
      - style
      - experimental
    disabled-checks:
      - hugeParam
      - paramTypeCombine

issues:
  exclude-rules:
    - linters:
        - errcheck
      text: "Error return value of `.*Close.*` is not checked"
```

### Appendix C: Diagnostic Recipes

Three diagnostic recipes for common situations.

**Recipe 1: My service heap is growing slowly. Is it timers?**

```sh
# 1. Capture a baseline.
curl http://localhost:6060/debug/pprof/heap > heap-1.pb.gz

# 2. Wait an hour.

# 3. Capture again.
curl http://localhost:6060/debug/pprof/heap > heap-2.pb.gz

# 4. Diff.
go tool pprof -base=heap-1.pb.gz -inuse_objects -top heap-2.pb.gz | head -20
```

If `time.NewTimer`, `time.After`, or `runtime.startTimer` appears in the top entries, it's timers.

**Recipe 2: Find the leaking call site.**

```sh
# Capture and view with a web UI; navigate the flame graph.
go tool pprof -http=:0 -inuse_objects http://localhost:6060/debug/pprof/heap
```

Filter the flame graph for `time.` and follow upward to user code. The call site is your leak.

**Recipe 3: I have a hunch about a specific function. Confirm or deny.**

```sh
# 1. Add the per-site wrapper to that function temporarily.
# 2. Deploy.
# 3. Query the metric:
curl http://localhost:9090/api/v1/query?query=go_live_timers_per_site\{site="myservice.MyFunc"\}
```

If the metric grows, the function leaks. If it's flat or sawtoothed, the function doesn't.

### Appendix D: Sample Alert Rules

For Prometheus-compatible monitoring:

```yaml
groups:
- name: go-timer-leaks
  rules:

  - alert: TimerLeakSuspected
    expr: deriv(go_live_objects[6h]) > 100
    for: 1h
    labels:
      severity: warning
    annotations:
      summary: "Slow object growth: possible timer or memory leak"
      runbook: "https://wiki/runbooks/timer-leak"

  - alert: TimerCountHigh
    expr: go_live_timers > 100000
    for: 30m
    labels:
      severity: warning
    annotations:
      summary: "Live timer count is high"

  - alert: GCPauseDrift
    expr: rate(go_gc_pause_total_nanoseconds[6h]) > rate(go_gc_pause_total_nanoseconds[7d] offset 7d) * 1.5
    for: 1h
    labels:
      severity: info
    annotations:
      summary: "GC pause time is drifting upward"
```

Tune thresholds for your service.

### Appendix E: Reading Order for This Topic

If you are joining a team that has timer leaks in its history, read in this order:

1. The `index.md` file in this folder — for the basic motivation.
2. The `junior.md` file — for the API mechanics and the standard idioms.
3. This file — for production-scale practices.
4. The `specification.md` file — for the reference details and Go-version differences.
5. The team's wiki page on "time-related code" — for the project-specific rules.

Then take a baseline heap profile of your service, set up the `runtime/metrics` exporter, and start watching. Within a week, you will have enough data to know whether your service has a leak.

---

### Appendix F: Common Mistakes Index

A short index of every leak pattern discussed in this document, with one-line summaries.

| Pattern | Severity | Detection |
|---|---|---|
| `time.After` in `for` loop with fast-firing other branch | High | Heap profile shows `time.NewTimer` dominant |
| `time.NewTicker` started but `Stop` never called | High | Heap + goroutine profile |
| `time.AfterFunc` return value discarded | Medium | Custom linter; heap profile |
| `context.WithTimeout` cancel discarded | Medium | `go vet -lostcancel` |
| `Reset` without `Stop`+drain | Low (correctness) | Manual audit; trace |
| Multiple flushers from racey init | High | `goleak`; goroutine profile |
| Reconnect loop allocates timer per attempt | High during incidents | Chaos test + heap profile |
| Per-request `AfterFunc` for slow-upstream tracking | Medium | Heap profile |

### Appendix G: A Final Word on Versions

Go's timer subsystem is one of the most active areas of runtime development. From Go 1.14 (per-P timer heaps) through Go 1.23 (cooperative cleanup of unreferenced timers), every major version has made the timer cheaper, faster, or safer. If you are reading this document from Go 1.25 or later, some of the dire warnings about pre-1.23 leaks will sound antiquated — and they will be. But fleets always run mixed versions; production binaries always lag the latest release; and the discipline of "stop what you start" is timeless. Use the latest version of Go you can; the runtime gets better with every release. But never rely on the runtime to clean up after careless code. The cheapest leak is the one that was never written.

---

### Appendix H: Per-Library Notes

Some popular Go libraries have known timer behaviour worth recording.

**`net/http`** — Every server-side request creates timers for read/write deadlines (if set). Every client request that uses `Client.Timeout` creates one timer. These are managed by the standard library and are leak-free if the request lifecycle completes normally. Leaks occur when the server side never finishes reading a request body, or when the client side never reads the response body.

**`google.golang.org/grpc`** — gRPC uses internal timers for keepalive pings, retry backoffs, and stream deadlines. Most are managed correctly, but the `KeepaliveParams` configuration includes a `Time` field that creates a ticker per connection. Long-lived connections that get torn down without proper close can leak the ticker.

**`go.uber.org/zap`** — The `zap.Logger` uses internal timers for batching writes when configured with a buffered writer. Not normally a leak source, but the buffered writer must be `Sync`'d before shutdown.

**`github.com/redis/go-redis`** — The connection pool uses tickers for idle connection cleanup. Pool teardown stops the ticker; abandoned pools leak the ticker.

**`github.com/jackc/pgx`** — Each connection has a context-based statement timeout, which creates a timer per query. Leak-free in normal use; leaks if queries are cancelled mid-flight by means other than context cancellation.

These notes are subject to change as libraries evolve; always check the upstream source if you suspect a library-level timer leak.

---

### Appendix I: Glossary

**Timer leak**: a timer (typically `*time.Timer`, `*time.Ticker`, or one created via `time.After`/`time.AfterFunc`) that is allocated but never properly cleaned up via `Stop` and whose associated channel and runtime-heap slot persist longer than intended.

**Timer heap**: the per-P min-heap that the Go runtime uses to track pending timers, sorted by their `when` value.

**Live count**: the number of timers currently outstanding (allocated but not yet stopped or fired). The single most useful telemetry for catching leaks.

**Per-call-site count**: live count attributed to the source location of the call that created the timer, useful for pinpointing the leaking line.

**Cancellation discarding**: assigning a `(ctx, _ = context.WithTimeout(...))` and throwing away the cancel function. A classic timer leak.

**Drain pattern**: the `if !t.Stop() { <-t.C }` idiom required to safely stop a timer that may have already fired.

**`goleak`**: the `go.uber.org/goleak` library for asserting no leaked goroutines remain after a test.

**`pprof`**: Go's built-in profiler, accessed via `net/http/pprof` or `runtime/pprof`. The standard tool for heap, CPU, and goroutine profiles.

**`runtime/metrics`**: the modern, stop-the-world-free alternative to `runtime.ReadMemStats`. Exposes a stable set of named metrics with explicit units.

**Continuous profiling**: a discipline of collecting pprof profiles from every pod at all times and centralizing them in a queryable system (Pyroscope, Parca, Datadog).

**Postmortem**: the structured writeup produced after an incident. For timer leaks, must include both "why we didn't catch it earlier" and "detection improvement."

**Retrofit**: the project of upgrading an existing codebase to follow timer-leak-resistant patterns. Typically a six-phase process described in this document.

**Chaos test**: a test that injects faults (e.g., flapping upstreams, killed pods, slow disk) into a service to expose hidden assumptions. The standard tool for catching reconnect-loop-style leaks.

---

### Appendix J: Practitioner's Cheat Sheet

A one-page reference for common timer-leak scenarios.

**You suspect a timer leak. What's the first command?**

```sh
go tool pprof -inuse_objects -top http://localhost:6060/debug/pprof/heap
```

If `time.NewTimer` or similar is in the top 5, you have a timer leak.

**You confirmed the leak. What's the second command?**

```sh
go tool pprof -http=:0 -inuse_objects http://localhost:6060/debug/pprof/heap
```

Navigate the flame graph to find the call site.

**You found the call site. What's the fix recipe?**

1. If it's `time.After` in a loop → replace with `NewTimer`/`Reset` pattern.
2. If it's `Ticker` without `Stop` → add `defer t.Stop()`.
3. If it's `AfterFunc` with discarded return → assign and `Stop` it.
4. If it's `context.WithTimeout` with discarded cancel → assign and `defer cancel()`.

**You fixed the code. What's the prevention recipe?**

1. Add a regression test using `goleak.VerifyNone(t)`.
2. Add a custom linter rule for the specific pattern.
3. Add a metric for `go_live_timers` with an alert on positive slope.
4. Write a one-paragraph postmortem and add a follow-up to audit other call sites.

This cheat sheet covers >95% of timer leaks in real Go codebases. The remaining 5% require deeper investigation with execution traces or custom instrumentation.

---

### Appendix K: Extended Reproducer Suite

The following extended reproducers cover edge cases that the main reproducer earlier in this document does not exercise. Each is self-contained and can be run with `go run`.

#### Reproducer K.1: The "Idle-Most" Loop

This reproduces the canonical `time.After`-in-loop leak when the channel branch is the rare case. The mirror image: when the timer branch is the rare case (i.e., the channel almost always wins), the leak is most severe. This reproducer demonstrates that.

```go
package main

import (
    "fmt"
    "runtime"
    "time"
)

func main() {
    ch := make(chan int, 100)
    go func() {
        for i := 0; ; i++ {
            ch <- i
        }
    }()

    var ms runtime.MemStats
    for i := 0; i < 30; i++ {
        for j := 0; j < 100_000; j++ {
            select {
            case <-ch:
            case <-time.After(10 * time.Second):
            }
        }
        runtime.ReadMemStats(&ms)
        fmt.Printf("iter=%d heap=%.1fMB live_objects=%d\n",
            i, float64(ms.HeapAlloc)/1e6, ms.Mallocs-ms.Frees)
    }
}
```

On Go 1.21 this produces, after 10 iterations, a heap of ~250 MB. On Go 1.23 the same code peaks at ~60 MB because the runtime GC collects unreferenced timers. The lesson: 1.23 narrows the absolute floor but does not eliminate the *peak* — a brief burst of allocation still consumes memory.

#### Reproducer K.2: The Hidden Sender

Sometimes the leaked timer is on a sender side, not a receiver side. This shows a "fire and forget" pattern that quietly leaks.

```go
package main

import (
    "fmt"
    "runtime"
    "sync/atomic"
    "time"
)

var fired int64

func main() {
    for i := 0; i < 1_000_000; i++ {
        time.AfterFunc(10*time.Second, func() {
            atomic.AddInt64(&fired, 1)
        })
    }
    var ms runtime.MemStats
    for i := 0; i < 20; i++ {
        runtime.ReadMemStats(&ms)
        fmt.Printf("t=%ds heap=%.1fMB fired=%d\n",
            i, float64(ms.HeapAlloc)/1e6, atomic.LoadInt64(&fired))
        time.Sleep(time.Second)
    }
}
```

Here we allocate one million `AfterFunc` timers up-front. They all fire after 10 seconds, after which heap drops back to baseline. While they are pending, heap is ~200 MB. This is not, strictly speaking, a leak — the timers do clean up — but it demonstrates the cost of having many concurrent timers.

#### Reproducer K.3: The Resetting Ticker

This reproduces a particularly subtle bug: a `Ticker` whose period is changed by stopping the old and creating a new one, but the old's channel is never drained.

```go
package main

import (
    "fmt"
    "runtime"
    "sync/atomic"
    "time"
)

type periodic struct {
    period int64 // atomic
    ticker *time.Ticker
}

func (p *periodic) UpdatePeriod(d time.Duration) {
    atomic.StoreInt64(&p.period, int64(d))
    // BUG: drop the old ticker without stopping it
    p.ticker = time.NewTicker(d)
}

func main() {
    p := &periodic{ticker: time.NewTicker(time.Second)}
    var ms runtime.MemStats
    for i := 0; i < 100; i++ {
        p.UpdatePeriod(time.Duration(i+1) * time.Millisecond)
        time.Sleep(10 * time.Millisecond)
        runtime.ReadMemStats(&ms)
        if i%10 == 0 {
            fmt.Printf("i=%d heap=%.1fMB goroutines=%d\n",
                i, float64(ms.HeapAlloc)/1e6, runtime.NumGoroutine())
        }
    }
}
```

Each `UpdatePeriod` call leaks the previous `*Ticker`. In a worst case (frequent period changes), the leak rate grows linearly with the update frequency. Heap profile would show `time.NewTicker` dominant.

#### Reproducer K.4: Context-Leak Cascade

Here we demonstrate how a single careless `WithTimeout` discard cascades into a steady leak.

```go
package main

import (
    "context"
    "fmt"
    "runtime"
    "time"
)

func leakyFetch(parent context.Context) {
    ctx, _ := context.WithTimeout(parent, 30*time.Second) // BUG: cancel discarded
    _ = ctx
    // Imagine an HTTP call here that returns quickly.
    time.Sleep(10 * time.Millisecond)
}

func main() {
    parent := context.Background()
    var ms runtime.MemStats
    for i := 0; i < 30; i++ {
        for j := 0; j < 1000; j++ {
            leakyFetch(parent)
        }
        runtime.ReadMemStats(&ms)
        fmt.Printf("iter=%d heap=%.1fMB live=%d\n",
            i, float64(ms.HeapAlloc)/1e6, ms.Mallocs-ms.Frees)
    }
}
```

After 30 iterations (~30,000 calls), heap shows ~10 MB of leaked context timers. The pattern: each call allocates a `cancelCtx` (containing a timer) and discards the cancel; the timer persists for up to 30 s. With 1,000 calls/iteration at 10 ms/call, ~3,000 timers are continuously live.

#### Reproducer K.5: The Slow Tail

A subtle and realistic reproducer: a leak that grows slowly enough to fool short-running tests but rapidly enough to harm long-running production.

```go
package main

import (
    "fmt"
    "runtime"
    "time"
)

func processRequest() {
    select {
    case <-time.After(time.Minute): // BUG: massive timeout, fast path almost always wins
    default:
        // fast path
    }
}

func main() {
    for i := 0; i < 60; i++ {
        for j := 0; j < 10_000; j++ {
            processRequest()
        }
        var ms runtime.MemStats
        runtime.ReadMemStats(&ms)
        fmt.Printf("t=%d heap=%.1fMB\n", i, float64(ms.HeapAlloc)/1e6)
        time.Sleep(time.Second)
    }
}
```

The `time.After(time.Minute)` is set to a long enough duration that every call leaks one timer for one minute. The growth is small per call but persistent. A short test that runs for only 5 seconds would see growth of ~50 MB; a real service running this for 24 hours would see ~720 GB if the GC didn't intervene. On 1.23 the runtime helps, but the per-iteration overhead is still substantial.

#### Reproducer K.6: The Channel Receiver That Holds the Reference

This pattern leaks even on Go 1.23, because the channel reference is kept alive.

```go
package main

import (
    "fmt"
    "runtime"
    "time"
)

type subscriber struct {
    ch <-chan time.Time
}

var subs []subscriber

func main() {
    for i := 0; i < 1_000_000; i++ {
        subs = append(subs, subscriber{ch: time.After(time.Hour)})
    }
    var ms runtime.MemStats
    runtime.ReadMemStats(&ms)
    fmt.Printf("heap=%.1fMB live=%d\n",
        float64(ms.HeapAlloc)/1e6, ms.Mallocs-ms.Frees)
    // Hold the slice live
    fmt.Println(len(subs))
}
```

Each `time.After` creates a timer whose channel is stored in the `subs` slice. The channel is reachable, the timer is reachable, the GC cannot collect any of it. Heap shows ~200 MB. Go 1.23 cannot rescue this case because the channel is referenced — exactly the case the new GC cooperation was *not* designed to fix.

---

### Appendix L: Production Telemetry Dashboard Recipe

A complete recipe for a Grafana dashboard that visualizes timer-related health for a Go fleet.

#### Panel 1: Live Object Count by Pod

```
go_live_objects{job="myservice"}
```

Use a time-series panel. Spike-or-slope behaviour indicates leaks. Add a baseline line at the mean over the last 7 days.

#### Panel 2: Goroutine Count by Pod

```
go_goroutines{job="myservice"}
```

Stacked area chart over all pods. A pod whose goroutine count steadily climbs is suspicious.

#### Panel 3: Live Timer Count (Custom Metric)

```
go_live_timers{job="myservice"}
```

Per-pod line. Alert if any single pod exceeds 100K timers.

#### Panel 4: Per-Site Timer Growth

```
topk(10, deriv(go_live_timers_per_site[1h]))
```

The top 10 fastest-growing call sites over the last hour. This identifies the leak before you even take a profile.

#### Panel 5: GC Pause Distribution

```
histogram_quantile(0.99, rate(go_gc_pause_seconds_bucket[5m]))
```

p99 GC pause over time. Drift upward correlates with heap growth.

#### Panel 6: Heap Allocation Rate

```
rate(go_memstats_alloc_bytes_total[5m])
```

Bytes allocated per second. Useful to distinguish "leaking" from "high-throughput".

#### Panel 7: Service Latency vs Heap

A correlation panel: x-axis is `go_heap_alloc_bytes`, y-axis is `http_request_duration_p99`. If they correlate positively, GC is degrading latency, which is a strong sign of memory pressure (possibly from leaks).

#### Panel 8: Recent Deploys Overlay

Annotations on the time-series panels for every deploy. When a heap leak begins immediately after a deploy, this overlay points the investigator at the responsible commit within seconds.

#### Alert Rules to Pair with the Dashboard

```yaml
- alert: TimerLeakRapid
  expr: deriv(go_live_timers[10m]) > 100
  for: 30m

- alert: TimerLeakSlow
  expr: deriv(go_live_timers[6h]) > 5
  for: 6h

- alert: HeapDrift
  expr: |
    quantile_over_time(0.1, go_memstats_heap_alloc_bytes[1h])
    >
    quantile_over_time(0.1, go_memstats_heap_alloc_bytes[1h] offset 6h) * 1.2
  for: 1h

- alert: GoroutinesUnbounded
  expr: deriv(go_goroutines[1h]) > 1
  for: 2h
```

Tune thresholds. The "rapid" alert catches deploys that immediately leak; the "slow" alert catches the long-tail leaks that survive multiple deploys.

---

### Appendix M: Operator Runbook

A step-by-step runbook for the on-call engineer when a timer-leak alert fires.

#### Step 1: Acknowledge and Verify

1. Acknowledge the alert in the alerting system.
2. Open the dashboard. Confirm the metric that fired matches reality (look for hysteresis, recent restarts).
3. Note the time of first growth — this is the regression window.

#### Step 2: Confirm It Is Timer-Related

1. Open the live `pprof` UI for one affected pod:
   ```sh
   kubectl port-forward pod/<podname> 6060:6060
   go tool pprof -http=:0 -inuse_objects http://localhost:6060/debug/pprof/heap
   ```
2. Look at the top entries. If `time.NewTimer`, `time.startTimer`, `time.After`, or `time.AfterFunc` appears in the top 5 with significant percentages, this is a timer leak.
3. If not, this is a different kind of leak — escalate to the on-call rotation responsible for that allocation type (e.g., string allocations might be a logging issue; large slices might be a cache issue).

#### Step 3: Capture Evidence

1. Save a heap profile:
   ```sh
   curl http://localhost:6060/debug/pprof/heap > heap-incident-$(date +%s).pb.gz
   ```
2. Save a goroutine profile:
   ```sh
   curl http://localhost:6060/debug/pprof/goroutine?debug=2 > goroutines-incident-$(date +%s).txt
   ```
3. Save a 30-second trace:
   ```sh
   curl 'http://localhost:6060/debug/pprof/trace?seconds=30' > trace-incident-$(date +%s).out
   ```
4. Upload all three to your incident-evidence store.

#### Step 4: Identify the Leak Site

1. In the heap profile, drill into the top timer-related stack.
2. Note the source file and line number.
3. Open the source. Look for the canonical patterns (loop with `time.After`, missing `Stop`, etc.).

#### Step 5: Mitigate

Choices, in order of preference:

1. **Roll back the suspect deploy**: if a recent deploy correlates with the leak's onset, roll back. This is the fastest mitigation and lets you investigate without time pressure.
2. **Increase memory limits**: temporary; buys hours, not days.
3. **Restart the pods on a schedule**: extends time before next OOM at the cost of operational burden. Acceptable as a stopgap, never as a fix.
4. **Apply a hotfix**: write the fix, test it locally with the reproducer, deploy in a canary, ramp up.

#### Step 6: Verify

After deploying the fix:

1. Confirm the metric stops growing in the dashboard.
2. Run the chaos test or load test that exercises the leak path.
3. Take a new heap profile and confirm the timer-related stacks are no longer dominant.

#### Step 7: Postmortem

Schedule a postmortem meeting within 5 business days. Use the template in this document. Action items must include:

1. Code fix (link to PR).
2. Detection improvement (new metric, alert, or linter).
3. Documentation update.

---

### Appendix N: Code Review Checklist for Time-Related Code

A printable checklist for code reviewers. Suggested practice: post it as a sticker on every PR that touches `time.*`.

**For every `time.After(...)`:**
- [ ] Is this inside a `for` loop?
- [ ] If yes, does the other `select` branch fire faster than the timer's duration?
- [ ] If yes, this is a leak. Replace with reusable `time.NewTimer` + `Reset`.

**For every `time.NewTimer(...)`:**
- [ ] Is there a corresponding `Stop()` call on all exit paths?
- [ ] Is the channel drained before `Reset()` if `Stop()` returns `false`?
- [ ] If used in a `select`, is the timer reused across iterations rather than recreated?

**For every `time.NewTicker(...)`:**
- [ ] Is `Stop()` called via `defer`?
- [ ] Is the ticker shared, or per-something? Per-request tickers are almost always wrong.

**For every `time.AfterFunc(...)`:**
- [ ] Is the return value assigned to a variable?
- [ ] Is the variable available to call `Stop()` on if the operation completes early?
- [ ] Is the underlying function idempotent in case of late firing?

**For every `context.WithTimeout(...)` or `context.WithDeadline(...)`:**
- [ ] Is the second return value assigned to a non-underscore name?
- [ ] Is `defer cancel()` called immediately after?
- [ ] If `cancel` is passed elsewhere, is its lifetime documented?

**For every new helper function that takes a `time.Duration`:**
- [ ] Does the function clearly document who owns the timer?
- [ ] Is the function cancellable via `context.Context`?
- [ ] Are there any latent leaks if the caller passes a long duration?

---

### Appendix O: Migration Guide from `time.After` to Wrappers

For teams retrofitting a codebase, here is a step-by-step migration guide.

#### Step 1: Audit

Run `grep -rn 'time\.After\|time\.NewTimer\|time\.NewTicker\|time\.AfterFunc' --include='*.go' .` and capture the output. Categorize each match by the categories in the audit table earlier in this document.

#### Step 2: Sort by Risk

Priority order:
1. `time.After` in `for` loops → highest risk
2. `time.NewTicker` outside `defer` → highest risk
3. `context.WithTimeout` with discarded cancel → high risk
4. `time.AfterFunc` with discarded return → medium risk
5. `time.NewTimer` with explicit `Stop` → low risk, generally OK

Fix in priority order. Stop after each batch to confirm no regressions.

#### Step 3: Mechanical Replacements

For `time.After` inside a `for` loop with `context.Context` available:

```go
// before:
for {
    select {
    case msg := <-ch:
        handle(msg)
    case <-time.After(5 * time.Second):
        return ErrTimeout
    }
}

// after:
t := time.NewTimer(5 * time.Second)
defer t.Stop()
for {
    if !t.Stop() {
        select {
        case <-t.C:
        default:
        }
    }
    t.Reset(5 * time.Second)
    select {
    case msg := <-ch:
        handle(msg)
    case <-t.C:
        return ErrTimeout
    }
}
```

For `context.WithTimeout` with discarded cancel:

```go
// before:
ctx, _ := context.WithTimeout(parent, d)

// after:
ctx, cancel := context.WithTimeout(parent, d)
defer cancel()
```

For `time.AfterFunc` with discarded return:

```go
// before:
time.AfterFunc(d, f)

// after:
t := time.AfterFunc(d, f)
defer t.Stop() // or document why we want it to fire even if we exit
```

#### Step 4: Wrapper Adoption

For new code, use the `timed` wrapper instead of raw `time.*`:

```go
// new code:
import "yourorg/timed"

t := timed.NewTimer(5 * time.Second)
defer t.Stop()
```

The wrapper provides metrics and is otherwise drop-in compatible.

#### Step 5: Lint and Enforce

Add the `banafterloop` and `mustcancel` analyzers to your CI. Configure them as errors, not warnings. New PRs that introduce a forbidden pattern fail the build.

#### Step 6: Re-Audit

After 30 days, re-run the audit. Count how many old patterns remain. Set a goal (e.g., "all `time.After`-in-loops removed by Q3") and track progress.

---

### Appendix P: Detailed Postmortem of Incident 1

This appendix expands on the "RPC gateway" incident with the full timeline, the exact code changes, and the metric impacts. It is intended as a worked example for engineers writing postmortems for similar incidents.

#### Background

The team owned a gateway service running on a Kubernetes cluster. The service had been in production for 18 months without significant incident. On day 0 of this incident, a feature was deployed that added a second downstream RPC dependency, doubling the number of outgoing connections per gateway instance.

#### Timeline

```
Day 0, 14:00 UTC — Feature deployed across 200 pods over 4h.
Day 0, 18:00 UTC — Deploy complete. Heap-per-pod is ~250 MB (normal).
Day 1, 02:00 UTC — Heap-per-pod is ~290 MB. Growth attributed to "warmup."
Day 1, 14:00 UTC — Heap-per-pod is ~380 MB. First "heap drift" alert fires.
Day 1, 18:00 UTC — First OOM kill on one pod. Operator notes and ignores.
Day 2, 02:00 UTC — 4 more OOM kills overnight. Operator escalates to oncall.
Day 2, 03:00 UTC — Oncall takes heap profile. Notes time.NewTimer dominant.
Day 2, 04:00 UTC — Oncall identifies the readLoop code path.
Day 2, 04:30 UTC — Patch drafted (NewTimer + Reset pattern).
Day 2, 06:00 UTC — Patch deployed to canary (10 pods).
Day 2, 10:00 UTC — Canary heap is flat. Patch ramped to 100%.
Day 2, 16:00 UTC — All pods stable. Incident closed.
```

Total impact: ~50 OOM kills, ~30 minutes of user-visible degraded latency, no full outage.

#### Code Diff

The patch (compressed):

```diff
 func (c *Conn) readLoop(ctx context.Context) {
+    t := time.NewTimer(30 * time.Second)
+    defer t.Stop()
     for {
+        if !t.Stop() {
+            select {
+            case <-t.C:
+            default:
+            }
+        }
+        t.Reset(30 * time.Second)
         select {
         case msg := <-c.incoming:
             c.dispatch(msg)
-        case <-time.After(30 * time.Second):
+        case <-t.C:
             c.keepalive()
         case <-ctx.Done():
             return
         }
     }
 }
```

#### Metric Impact

Pre-fix, post-fix comparison over 24 hours of normal traffic:

| Metric | Pre-Fix | Post-Fix |
|---|---|---|
| Mean heap/pod | 380 MB | 220 MB |
| p99 heap/pod | 1.1 GB | 240 MB |
| OOM kills/day | 28 | 0 |
| p99 GC pause | 45 ms | 8 ms |
| p99 request latency | 180 ms | 95 ms |
| CPU usage | 45% | 38% |

The latency improvement was surprising — the team had not realized that GC pauses on the leaked heap were degrading p99 latency. The CPU improvement comes from fewer GC cycles.

#### Why It Wasn't Caught Earlier

1. **No timer-count metric**: the team monitored heap and goroutines but not timers specifically.
2. **No leak detection in tests**: existing tests didn't run long enough to exhibit the leak.
3. **Go vet disabled**: `lostcancel` was disabled in CI due to a false positive from years prior.
4. **No load testing with fanout**: pre-deploy load tests used the old fanout pattern; the new pattern wasn't exercised.

#### Follow-Up Actions

1. Add `go_live_timers` metric to all services. Owner: platform team. ETA: 2 weeks.
2. Re-enable `go vet -lostcancel` in CI. Owner: this team. ETA: 1 week.
3. Add chaos test that doubles fanout for 1 hour. Owner: this team. ETA: 4 weeks.
4. Audit all `time.After` uses in this service. Owner: this team. ETA: immediate.
5. Document the "long-lived timer + Reset" pattern in team wiki. Owner: this team. ETA: 1 week.

#### Lessons for Other Teams

1. A feature that changes workload shape can expose latent leaks. Always test with the new workload.
2. Heap profiles are the first tool for any memory growth investigation.
3. The `time.After`-in-loop pattern is dangerous. Adopt the long-lived-timer pattern by default.

---

### Appendix Q: Comparative Behaviour Across Go Versions

This appendix tabulates how the timer subsystem behaves across recent Go versions, with emphasis on leak-related changes.

#### Go 1.14

- Per-P timer heaps introduced.
- Major performance improvement over pre-1.14 global timer heap.
- No changes to `time.After` semantics; same leak risk as 1.0.

#### Go 1.15–1.20

- Incremental optimizations to timer firing path.
- No semantic changes to `time.After`, `Timer.Stop`, or `Reset`.
- Same leak patterns apply.

#### Go 1.21

- New `slog` package; no timer changes.
- Minor timer-heap optimization.
- Same leak patterns apply.

#### Go 1.22

- Loop variable scoping changes (range loops).
- No direct timer changes.
- Same leak patterns apply.

#### Go 1.23

- **Major timer rewrite.**
- `time.After` timers can be GC'd when no goroutine holds a reference to the returned channel.
- Timer channels switched from async to synchronous delivery semantics.
- `Timer.Reset` on a fired-but-unread timer now discards the prior tick.
- Many old leak patterns become merely "wasteful" rather than catastrophic.

#### Go 1.24

- Continued optimization of the 1.23 timer model.
- Trace events for timer lifecycle (per upstream issue discussions).

#### What This Means for Operators

If your fleet is on Go 1.23 or later:
- The drain-before-Reset pattern is no longer strictly necessary, but still recommended for code clarity.
- `time.After` in a loop is much less catastrophic, but still wasteful.
- Heap profiling for `time.NewTimer` is still the right detection technique.

If your fleet is on Go 1.21 or 1.22:
- All warnings in this document apply at full strength.
- Upgrading to 1.23 will reduce timer-related GC pressure significantly.
- Plan the upgrade as a memory-pressure mitigation in its own right.

If your fleet is mixed:
- Treat the lowest-common-denominator version as the floor for any leak-resistance guarantee.
- The `timed` wrapper described in this document works across all versions.

---

### Appendix R: Memory Cost Worksheet

A worksheet for estimating the memory impact of a suspected timer leak. Fill in the blanks for your specific case.

```
Service name: __________________
QPS (requests/sec): __________________
Per-request leaked timers (estimate): __________________
Timer duration (typical): __________________ seconds

Calculation:
  Live leaked timers = QPS × leaked-timers-per-request × duration
  Memory cost = Live leaked timers × 220 bytes

Example:
  Service: gateway
  QPS: 5,000
  Per-request leaked timers: 1
  Duration: 30 s

  Live timers = 5,000 × 1 × 30 = 150,000
  Memory cost = 150,000 × 220 = 33 MB

Worksheet:
  Live timers = ______ × ______ × ______ = ______
  Memory cost = ______ × 220 = ______ bytes
```

For high-leak scenarios (e.g., > 1 GB calculated cost), the leak is likely to OOM before reaching steady state. For low-leak scenarios (e.g., < 100 MB), the leak is harmful long-term but won't crash immediately.

#### Bonus: GC Cost Estimate

Each live timer adds roughly 50 nanoseconds to GC scan time per cycle (varies by heap layout). 1 M timers therefore add ~50 ms per GC cycle.

```
GC pause increase ≈ Live timers × 50 ns
```

For services with strict latency SLOs, the GC pause cost can be more impactful than the memory cost.

---

### Appendix S: Reading List

For deeper study, the following resources are recommended.

#### Primary Sources

1. **Go source code**:
   - `src/time/sleep.go` — `time.After`, `time.NewTimer`, `Reset`, `Stop`.
   - `src/time/tick.go` — `time.Ticker` and `time.Tick`.
   - `src/runtime/time.go` — runtime timer implementation.
   - `src/runtime/proc.go` — scheduler integration with timers.

2. **Go release notes**:
   - Go 1.14 release notes — per-P timer heap.
   - Go 1.23 release notes — timer rewrite.

3. **Go memory model**: `https://go.dev/ref/mem` — happens-before semantics relevant to timer + channel interactions.

#### Secondary Sources

1. Dmitri Vyukov's notes on timer implementation (search: "vyukov go timer").
2. Russ Cox's "Channels and Their Synchronization Costs" — relevant to timer-channel delivery semantics.
3. Filippo Valsorda's GopherCon talks on Go internals — occasionally cover timer behaviour.
4. Brad Fitzpatrick's posts on `net/http` internals — discuss timer use in the standard library.

#### Tools

1. `go tool pprof` documentation: `https://pkg.go.dev/net/http/pprof`.
2. `goleak` repository: `https://github.com/uber-go/goleak`.
3. `staticcheck` documentation: `https://staticcheck.io/docs/`.
4. Pyroscope, Parca, Polar Signals — continuous profiling platforms.

#### Community

1. Go GitHub issues — search for "timer leak" for the long history of related bugs and fixes.
2. Gopher Slack `#performance` channel — practitioners discuss leak debugging.
3. Reddit `/r/golang` — informal but occasionally informative incident reports.

---

### Appendix T: Edge Cases and Gotchas

A grab-bag of niche issues that don't fit anywhere else.

#### Timer firing during GC

If a timer fires during a stop-the-world GC pause, the fire is delayed until GC completes. For typical pause times (<10 ms) this is invisible. For services with long pauses (hundreds of ms), timers fire late, which can cause spurious timeouts.

Mitigation: keep heap size bounded (which reduces GC pause); don't rely on timers for high-precision sub-10ms scheduling.

#### Timer storms after a long pause

If the process is paused (e.g., by SIGSTOP or by a Docker pause) and resumes, all pending timers whose `when` is in the past fire immediately, often in a single burst. This can overwhelm dependent goroutines.

Mitigation: use the monotonic clock (`time.Time.Sub` does this automatically). Be prepared for batched timer events on resume.

#### `time.Tick` is a known footgun

`time.Tick(d)` returns a channel that ticks forever. There is no way to stop it. Any code that calls `time.Tick` inside a function-local scope leaks the ticker for the lifetime of the program.

```go
// LEAK: this ticker can never be stopped.
go func() {
    for range time.Tick(1 * time.Second) {
        doWork()
    }
}()
```

Use `time.NewTicker` and `defer t.Stop()` instead. `staticcheck` flags `time.Tick` in non-`main` functions as `SA1018`.

#### Negative durations

`time.NewTimer(-d)` fires immediately (or close to it). This is rarely intentional and often the symptom of a bug (e.g., subtracting `time.Now()` from an earlier time). Code paths that compute durations from absolute times should clamp to non-negative.

#### `time.Sleep(0)`

`time.Sleep(0)` is well-defined: it yields the goroutine to the scheduler. It does not allocate a timer. Useful (rarely) as a yield primitive.

#### Daylight saving and wall-clock vs monotonic

`time.Now()` returns a value that contains both wall-clock and monotonic components. Arithmetic on `time.Time` values uses the monotonic component, which is immune to DST and NTP adjustments. Don't use `Time.Unix()` for duration math.

#### `time.AfterFunc` reentrance

The `func` passed to `time.AfterFunc` runs in a goroutine of the runtime's choosing. If the function blocks on a mutex held by other code, you can deadlock. Always design `AfterFunc` callbacks to be short and non-blocking.

#### Timer drift in `Ticker`

`time.NewTicker(d)` ticks approximately every `d`, but does *not* attempt to maintain an exact phase. After missed ticks (e.g., due to a long GC pause), the ticker resumes from the current time, not from the original phase. For applications that need precise periodicity, accumulate the next-fire time explicitly.

#### Closed channels and `time.After`

You cannot close `time.After`'s returned channel. It is owned by the runtime. Don't try.

#### Many `time.After` in a single select

```go
select {
case <-time.After(1 * time.Second):
case <-time.After(2 * time.Second):
case <-time.After(3 * time.Second):
}
```

Three timers are allocated. The first one fires after 1 second; the other two leak for 2 and 3 seconds respectively. This is a leak even if the function returns immediately after the select.

Mitigation: use a single timer with the shortest duration, or use `context.WithTimeout` with a single deadline.

---

### Appendix U: The Pre-1.23 Drain Pattern in Detail

The "drain before reset" pattern,

```go
if !t.Stop() {
    select {
    case <-t.C:
    default:
    }
}
t.Reset(d)
```

is one of the most-asked-about idioms in Go. This appendix dissects it carefully.

#### The problem `Stop` solves

`Stop` returns `true` if it prevented the timer from firing; otherwise `false`. `false` means one of two things:
1. The timer had already fired before `Stop` was called.
2. The timer had already been stopped before this `Stop` call.

In case 1, the value (a `time.Time`) was placed on `t.C` (with a buffer of 1) and is still sitting there. Any subsequent receive on `t.C` will get this value, not the next one. If you then call `Reset(d)` and `select` on `t.C`, the first receive returns the *old* value immediately.

#### Why the `default` in the drain

```go
select {
case <-t.C:
default:
}
```

If the buffered value is there, the first case fires and drains it. If the channel is empty (case 2 above), the `default` prevents blocking.

#### Why this is no longer strictly needed in Go 1.23

In Go 1.23, the channel underlying a timer uses synchronous delivery. There is no buffered value to drain. `Reset` clears any pending fire. The drain pattern still works but is unnecessary.

For pre-1.23 codebases, the drain pattern is mandatory. Skipping it produces the "Forgotten Reset" race from incident 2.

#### A simpler pattern (post-1.23 only)

```go
t.Stop()
t.Reset(d)
```

Two lines. Clear. Safe on Go 1.23.

#### Cross-version compatibility

If your code must support both pre-1.23 and 1.23+, use the drain pattern. It is safe on all versions, merely redundant on 1.23.

---

### Appendix V: Anti-Patterns Gallery

A gallery of specific code patterns that should fail code review. For each, the pattern is shown, the reason it's bad is explained, and the fix is given.

#### Pattern 1: `time.After` in a tight loop

```go
// BAD
for {
    select {
    case msg := <-ch:
        handle(msg)
    case <-time.After(d):
        timeout()
    }
}
```

**Why**: each iteration leaks a timer for up to `d`.

**Fix**: use a reusable timer with `Reset`.

#### Pattern 2: `Ticker` without `Stop`

```go
// BAD
ticker := time.NewTicker(time.Second)
go func() {
    for range ticker.C {
        work()
    }
}()
```

**Why**: the ticker is never stopped. If the goroutine exits (via a path not shown), the ticker keeps ticking and the channel keeps receiving values.

**Fix**: `defer ticker.Stop()` paired with a context-cancellation case in the goroutine's loop.

#### Pattern 3: Discarded `cancel` from `WithTimeout`

```go
// BAD
ctx, _ := context.WithTimeout(parent, d)
doWork(ctx)
```

**Why**: the underlying timer leaks for up to `d`.

**Fix**: `ctx, cancel := context.WithTimeout(parent, d); defer cancel()`.

#### Pattern 4: `AfterFunc` with discarded return

```go
// BAD
time.AfterFunc(d, func() { sendEmail() })
```

**Why**: there is no way to cancel this if the work it represents completes before `d` elapses.

**Fix**: capture the return and `defer Stop()`.

#### Pattern 5: `time.Tick` in non-`main` scope

```go
// BAD
func process() {
    for range time.Tick(time.Second) {
        work()
    }
}
```

**Why**: the ticker leaks for the lifetime of the program, even if `process` returns.

**Fix**: `time.NewTicker` + `defer Stop`.

#### Pattern 6: Goroutine without exit on `done`

```go
// BAD
go func() {
    for {
        select {
        case <-time.After(time.Hour):
            cleanup()
        }
    }
}()
```

**Why**: the goroutine never exits; the timer is recreated forever. If `cleanup` becomes obsolete, you have a leaked goroutine + a steady stream of leaked timers.

**Fix**: add a `case <-ctx.Done(): return` branch and pass a cancellable context.

#### Pattern 7: Storing `time.After` results

```go
// BAD
type Job struct {
    deadline <-chan time.Time
}

func New(d time.Duration) *Job {
    return &Job{deadline: time.After(d)}
}
```

**Why**: the timer cannot be stopped because the `*Timer` is dropped.

**Fix**: store `*time.Timer` and provide a `Stop()` method on `Job`.

#### Pattern 8: Mutex held during timer wait

```go
// BAD
mu.Lock()
defer mu.Unlock()
<-time.After(time.Second)
```

**Why**: not a leak in the strict sense, but a code smell. The mutex is held for a full second; other goroutines waiting on the mutex are blocked. Combined with timer leaks, this amplifies contention.

**Fix**: don't hold mutexes during timer waits. Restructure to compute the wait outside the critical section.

---

### Appendix W: A Heuristic for Estimating Leak Severity

Given a heap profile that shows `time.NewTimer` at X% of live objects, this heuristic estimates the leak's severity.

| X | Severity | Action |
|---|---|---|
| < 1% | Normal | No action |
| 1–5% | Watch | Monitor over a week |
| 5–15% | Concerning | Investigate within a week |
| 15–40% | Serious | Investigate immediately |
| > 40% | Critical | Hotfix |

The exact thresholds depend on your service. A service that legitimately uses many timers (e.g., a scheduler) might have 30% timer allocations as steady state. A service that rarely uses timers should never exceed a few percent.

#### Calibrating for your service

To set thresholds for your service:

1. Take a heap profile of a healthy production pod.
2. Note the percentage of live objects under `time.NewTimer` and related stacks.
3. Set "concerning" at 3× this baseline.
4. Set "critical" at 10× this baseline.

Update the thresholds annually as code evolves.

---

### Appendix X: A Note on `runtime.SetFinalizer`

A reader might wonder: can I attach a `runtime.SetFinalizer` to a `*time.Timer` to detect when it's leaked?

```go
t := time.NewTimer(d)
runtime.SetFinalizer(t, func(t *time.Timer) {
    log.Printf("LEAK: timer not stopped")
})
```

This *almost* works but has problems:

1. The finalizer runs at GC time, not at leak time. Detection is delayed by up to a full GC cycle (seconds to minutes).
2. The finalizer prevents the timer from being collected on the same GC cycle as detection; it requires two cycles.
3. A timer that has fired and whose channel value was consumed is "not stopped" but is also not really leaked. The finalizer cannot distinguish these cases.

Result: finalizers are not a useful leak-detection technique. The wrapper-based live count is much more reliable.

---

### Appendix Y: The "I'm Not Sure If It's a Leak" Decision Tree

A flowchart, in text form, for the operator who suspects but is not sure.

```
1. Is heap growing over time?
   ├─ No: not a leak.
   └─ Yes: go to 2.

2. Is heap growth sawtoothed (returns to baseline after GC)?
   ├─ Yes: not a leak; high allocation rate is the issue. Look at allocation profile.
   └─ No: go to 3.

3. Take a heap profile. Is `time.NewTimer` or related in top 5?
   ├─ Yes: timer leak. Find the call site and fix.
   └─ No: go to 4.

4. Are goroutines growing?
   ├─ Yes: goroutine leak. Take a goroutine profile and find the parking site.
   └─ No: go to 5.

5. Is something else in the heap profile dominant?
   ├─ Yes: investigate that thing.
   └─ No: take more profiles over time; the leak may be diffuse.
```

This tree resolves 90% of "is it a leak?" questions in under 5 minutes.

---

### Appendix Z: Final Production Checklist

Before deploying any Go service to production, verify:

- [ ] `runtime/metrics` exporter is wired up and metrics are scraped.
- [ ] `pprof` endpoints are exposed on a debug port.
- [ ] `go vet -lostcancel` runs in CI and fails on violations.
- [ ] `staticcheck` runs in CI.
- [ ] `goleak.VerifyTestMain` is in at least one test file per package.
- [ ] A live-timer-count metric is exported (using the `timed` wrapper or equivalent).
- [ ] Alerts are configured for heap drift, goroutine drift, and timer count.
- [ ] An on-call runbook exists for timer-leak investigation.
- [ ] A heap profile snapshot is automated (e.g., hourly to S3).
- [ ] A chaos test exercises reconnect loops, slow upstreams, and partial failure modes.
- [ ] Code review checklist for time-related code is documented and used.
- [ ] At least one engineer on the team has debugged a real timer leak end-to-end.

A service that passes this checklist can carry the risk of timer leaks safely. A service that fails any item is operating with avoidable risk.

---

### Appendix AA: Worked Example — Investigating a Live Leak in 30 Minutes

This appendix is a complete, step-by-step trace of an investigation, from alert to fix, intended to give junior on-call engineers a concrete example.

#### Minute 0: Alert

PagerDuty rings. The alert message: "go_live_objects on `ingest-service` growing at 200/s sustained for 6 hours."

#### Minute 1: Acknowledge

You acknowledge in PagerDuty and open the alert's dashboard link. The dashboard shows:

- `go_live_objects` rising linearly from 1.2 M at 06:00 UTC to 5.5 M at 12:00 UTC.
- `go_goroutines` flat at 4,200.
- `go_heap_alloc` rising from 800 MB to 1.4 GB.
- `go_gc_cycles` rate decreased from 12/min to 5/min (consistent with growing heap).
- No recent deploys.

#### Minute 3: Hypothesis

The fact that `go_goroutines` is flat while objects and heap rise strongly suggests *not* a goroutine leak. The likely candidates are timer leaks, channel leaks, or cache leaks. The lack of a recent deploy means this is a long-standing latent issue triggered by something today.

#### Minute 5: Capture Evidence

You SSH to a bastion host with `kubectl` access. You identify one of the worst-affected pods:

```sh
kubectl top pods -n ingest | sort -k3 -h | tail -5
```

Output:
```
ingest-7d8f9-x4q92    480m    1340Mi
ingest-7d8f9-bzx81    520m    1380Mi
ingest-7d8f9-mhw3p    490m    1420Mi
ingest-7d8f9-knq42    510m    1460Mi
ingest-7d8f9-ts9k1    505m    1490Mi
```

You pick `ts9k1` and port-forward its pprof port:

```sh
kubectl port-forward -n ingest pod/ingest-7d8f9-ts9k1 6060:6060 &
```

#### Minute 7: Heap Profile

You capture and open a heap profile:

```sh
curl -o heap.pb.gz http://localhost:6060/debug/pprof/heap
go tool pprof -inuse_objects -top heap.pb.gz | head -15
```

Output:
```
File: ingest
Type: inuse_objects
Time: 2026-01-15 12:08:00 UTC
Showing nodes accounting for 3825641, 84.2% of 4543250 total
Dropped 142 nodes (cum <= 22716)
      flat  flat%   sum%        cum   cum%
   1820000   40.1%   40.1%    1820000   40.1%  time.NewTimer
   1180000   26.0%   66.1%    1180000   26.0%  time.startTimer (inline)
    420000    9.2%   75.3%     420000    9.2%  runtime.makechan
    260000    5.7%   81.0%     260000    5.7%  context.(*timerCtx).Done
    145641    3.2%   84.2%     145641    3.2%  bytes.makeSlice
```

Two thirds of all live objects are timer-related. This is a timer leak.

#### Minute 10: Find the Call Site

You open the web UI:

```sh
go tool pprof -http=:8888 -inuse_objects heap.pb.gz
```

Switch to "Flame Graph" view. Drill down through `time.NewTimer`. The callers are:

- `context.WithTimeout` → 26%
- `time.After` → 31%
- `time.NewTimer` direct → 5%
- Other → 2%

You expand the `time.After` branch. It comes from `(*StreamProcessor).processBatch` at `processor.go:108`.

#### Minute 13: Read the Code

```go
func (p *StreamProcessor) processBatch(batch []Record) error {
    for _, rec := range batch {
        select {
        case p.outputCh <- rec:
        case <-time.After(50 * time.Millisecond):
            return ErrBackpressure
        }
    }
    return nil
}
```

There it is. The classic anti-pattern: `time.After` inside a loop with a fast-firing other case. `outputCh` is buffered and usually has space; the timer almost never fires; each timer is leaked for 50 ms.

#### Minute 15: Confirm the Hypothesis

You check the load:

- Each batch contains ~100 records.
- Batches are processed at ~500/s per pod.
- That's ~50,000 timer allocations per second per pod.
- Each timer lives for 50 ms, so the live timer count per pod is ~2,500 — but the leak compounds because timers are reachable through the runtime heap even after the select returns.

The math checks: 50,000 timers/s × 50 ms = 2,500 live per pod. Multiplied by Go 1.21's per-timer cost of ~250 bytes, that's 625 KB per pod, which is small. But the *allocation rate* is high (50,000/s × 250 B = 12.5 MB/s), which keeps the GC busy, and the timer-heap manipulation cost shows up as CPU overhead. Over hours, even a small steady-state live count combined with high allocation rate produces visible heap drift because the GC cannot keep up.

#### Minute 18: Write the Fix

```go
func (p *StreamProcessor) processBatch(batch []Record) error {
    t := time.NewTimer(50 * time.Millisecond)
    defer t.Stop()
    for _, rec := range batch {
        if !t.Stop() {
            select {
            case <-t.C:
            default:
            }
        }
        t.Reset(50 * time.Millisecond)
        select {
        case p.outputCh <- rec:
        case <-t.C:
            return ErrBackpressure
        }
    }
    return nil
}
```

A single reusable timer instead of one per record.

#### Minute 22: Test the Fix

You run the package's tests:

```sh
go test ./internal/processor/...
```

All pass. You also run the leak-specific test (if one exists; if not, you make a note to write one).

#### Minute 25: Deploy

You commit, push, and trigger a canary deploy:

```sh
git checkout -b fix/timer-leak-processor
git commit -am "fix: reuse timer in processBatch to avoid leak"
git push origin fix/timer-leak-processor
gh pr create --title "Fix timer leak in processBatch" --body "Heap profile showed time.After dominant. See incident IR-12345."
```

After PR approval (which the on-call lead can do directly during an incident), you merge. The deploy pipeline ramps to 10 pods.

#### Minute 30: Monitor

You watch the dashboard. On the 10 canary pods, `go_live_objects` plateaus and begins to fall slightly as GC catches up. After 5 minutes you ramp to 100%. The incident is resolved.

#### Postmortem Notes

Five days later, the team holds a postmortem. Key questions:

1. **Why did it surface today?** Investigation shows that ingest volume had grown gradually over months; today's volume happened to push past a threshold where the GC could no longer keep up with the timer allocations. The leak had been present in code for over a year.
2. **Why wasn't it caught earlier?** No timer-count metric was exported. The heap drift had been attributed to "warmup" by previous on-calls.
3. **What changes prevent recurrence?** (a) Add `go_live_timers` metric. (b) Add a custom linter rule for `time.After` in `for` loops. (c) Add a chaos test that runs the processor at 3× steady-state load for one hour.

Total time from alert to fix deployed: 30 minutes. Total impact: zero user-visible — the heap was high but had not yet caused OOMs.

This is the ideal incident: quick diagnosis, narrow fix, no escalation. It is possible because the team had the diagnostic infrastructure in place: pprof endpoints, dashboards, runbook. Without those, the same incident might have taken hours of debugging or led to OOMs before the cause was found.

---

### Appendix AB: Worked Example — The Slow Leak That Took Three Weeks to Catch

A contrasting example: a leak that did not yield to a 30-minute investigation. This appendix is the story of how the team eventually identified and fixed it.

#### Background

A microservice handling background image processing had heap growing by ~3 MB/day. Pods were restarted weekly as a maintenance action, so the growth never triggered alerts. The team noticed only because someone graphed memory-over-time during a capacity review and asked "why is the trend positive?"

#### Week 1: Initial Investigation

The on-call engineer took a heap profile. `time.NewTimer` was the third-largest allocator at 8%. Not dominant, not negligible. They couldn't easily attribute it to a single call site because four different code paths contributed roughly equally.

They wrote a hunch into the issue tracker: "Possible slow timer leak; needs longer investigation."

#### Week 2: Deeper Profiling

A second engineer took heap profiles at hourly intervals for 12 hours. They diffed the first and last:

```sh
go tool pprof -base=heap-00.pb.gz -inuse_objects -top heap-12.pb.gz
```

The diff showed growth in `time.NewTimer` of ~10,000 objects over 12 hours, or ~830/hour. Attributed to two call sites: `worker.go:88` (~600/hour) and `monitor.go:42` (~230/hour).

They examined `worker.go:88`:

```go
func (w *Worker) processOne(job *Job) error {
    ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
    defer cancel()

    result, err := w.execute(ctx, job)
    if err == ErrTransient {
        // Schedule a retry in 30 seconds.
        time.AfterFunc(30*time.Second, func() {
            w.queue.Push(job)
        })
        return nil
    }
    return err
}
```

The `time.AfterFunc` was the leak: when transient errors were rare (say, 1 in 100 jobs), this code created ~1 timer per 100 jobs. At 60,000 jobs/hour, that's 600 timers/hour leaked for 30 seconds each. The bug: the timer was never stopped, even if the worker was shut down.

The fix:

```go
if err == ErrTransient {
    t := time.AfterFunc(30*time.Second, func() {
        w.queue.Push(job)
    })
    w.pendingRetries.Add(t)
    return nil
}
```

Plus a corresponding `Close` method on the worker that stops all pending retries.

#### Week 3: The Second Leak

After the first fix, heap growth slowed but did not stop. The engineer went back to `monitor.go:42`:

```go
func (m *Monitor) Watch() {
    for {
        select {
        case event := <-m.events:
            m.handle(event)
        case <-time.After(1 * time.Minute):
            m.heartbeat()
        }
    }
}
```

The classic `time.After`-in-loop pattern. Events were rare (one per few seconds on average), so the timer usually fired. But during quiet periods, the events were even rarer (sometimes minutes between events), and each iteration's timer was leaked for up to 60 seconds.

Standard fix: reusable timer with `Reset`.

#### Outcome

After fixing both leaks, heap growth went to zero over 5 days of observation. Pod uptime extended from 7 days to 60 days (the limit imposed by other factors, not memory).

#### Lessons

1. **Slow leaks are diagnostically harder than fast leaks.** A 3 MB/day leak is invisible on most dashboards. The only signal is long-term trend, which is harder to monitor.
2. **Multi-source leaks are common.** This service had two independent leaks. The first investigation found one; the second investigation found the other. Don't assume there is exactly one cause.
3. **Per-call-site attribution is essential.** Without the per-site live-timer metric, diagnosing two leaks would have been ambiguous: the heap profile would have shown `time.NewTimer` consolidated.
4. **Weekly pod restarts mask leaks.** This is a maintenance pattern that should be questioned, not normalized. A service that needs weekly restarts is hiding a bug.

---

### Appendix AC: Library and Framework Considerations

When you depend on a third-party library, you inherit its timer hygiene (or lack thereof). This appendix is a short guide to evaluating libraries.

#### Evaluating a Library for Timer Hygiene

Before adopting a library that does any concurrent or scheduled work, check:

1. **Does it expose lifecycle methods?** A library that creates timers should provide a `Close`, `Stop`, or `Shutdown` method. If not, those timers may leak.
2. **Is the lifecycle documented?** The library's docs should say "you must call `Close()` to release resources" — or similar.
3. **Does its API let you pass a `context.Context`?** Context-aware libraries can be cancelled cleanly. Libraries that don't accept contexts must be shut down through other means.
4. **What does its test suite verify?** A library with `goleak.VerifyTestMain` in its tests has at least considered leak prevention. A library without it has not.
5. **Are there known leak bugs?** Search the library's issue tracker for "leak" and "timer."

#### Common Library Pitfalls

**HTTP clients**: The standard `net/http.Client` does not leak timers when used correctly. Mistakes include: (a) not closing response bodies, which leaves connections alive and (sometimes) timers attached; (b) using `Client.Timeout` and `Request.Context` simultaneously in conflicting ways. Use one or the other.

**Database drivers**: Most drivers use timers for query timeouts and connection pool maintenance. If you set `db.SetConnMaxLifetime` to a non-zero value, the pool spawns a maintenance goroutine with a timer. This is fine for the life of the program, but if you create and destroy `*sql.DB` instances, you must `Close()` each one to stop the goroutine.

**Message queue clients**: Kafka, RabbitMQ, NATS clients all use background goroutines with tickers for heartbeats, reconnects, and maintenance. Their `Close()` methods must be called.

**Tracing and metrics SDKs**: OpenTelemetry, Jaeger, Prometheus clients spawn batching goroutines with tickers. Their shutdown methods (often `Shutdown(ctx)` or `Stop()`) must be called.

**Background-job libraries**: `asynq`, `machinery`, and similar use timers internally. Their server objects must be closed.

#### Auditing Dependencies for Timer Hygiene

A useful one-time exercise: for each major dependency, write a sentence in your team wiki:

> "Library X creates Y timers per Z. Shutdown is Q."

Examples:

> "google.golang.org/grpc creates approximately 1 timer per connection (for keepalive) plus 1 per call (for deadline). Shutdown is `Server.GracefulStop()` and `ClientConn.Close()`."

> "go.uber.org/zap with buffered output creates 1 ticker per logger. Shutdown is `Logger.Sync()`."

This audit, done once, makes future investigations much faster.

---

### Appendix AD: Performance Cost of the `timed` Wrapper

A natural question: what is the runtime cost of the wrapper introduced in this document, compared to raw `time.NewTimer`?

#### Microbenchmark

```go
package timed

import (
    "testing"
    "time"
)

func BenchmarkRawNewTimer(b *testing.B) {
    for i := 0; i < b.N; i++ {
        t := time.NewTimer(time.Hour)
        t.Stop()
    }
}

func BenchmarkWrappedNewTimer(b *testing.B) {
    for i := 0; i < b.N; i++ {
        t := NewTimer(time.Hour)
        t.Stop()
    }
}
```

Results on a 2024-era x86_64 server, Go 1.22:

```
BenchmarkRawNewTimer-16        15000000      80 ns/op    176 B/op    2 allocs/op
BenchmarkWrappedNewTimer-16    12000000      95 ns/op    192 B/op    3 allocs/op
```

Overhead per create+stop: ~15 ns and 16 bytes. For a service issuing 10,000 timer ops/s, that's 0.15 ms/s of extra CPU and 160 KB/s of extra allocation — negligible.

#### Adding Per-Site Tracking

The per-site variant adds a `runtime.Callers` call, which is more expensive:

```
BenchmarkWrappedWithSiteNewTimer-16    3000000    340 ns/op    320 B/op    5 allocs/op
```

Overhead per op: ~260 ns and ~144 bytes. For 10,000 ops/s, ~2.6 ms/s CPU and ~1.4 MB/s allocation. Tolerable for most services; expensive for hot paths.

#### Practical Guidance

- Use the basic wrapper (without per-site tracking) by default. Overhead is negligible.
- Use the per-site variant only when actively investigating a leak, or in development/staging environments.
- For ultra-hot paths (millions of timer ops/s), consider whether you need timers at all. Often, restructuring to use a single long-lived timer per worker is both more efficient and leak-free by construction.

---

### Appendix AE: Cross-Language Comparison

Brief notes on how other languages handle the equivalent problem.

#### Java

Java's `java.util.Timer` and `ScheduledExecutorService` create thread-bound timers. Leaks manifest as leaked tasks, not directly visible in heap dumps as "timers" but visible as task queue entries. The standard tool is `jstack` for thread state and `jmap` for heap dumps. Common bugs mirror Go's: tasks scheduled but never cancelled.

#### Node.js

`setTimeout` and `setInterval` create timers managed by the Node event loop. Leaks are visible in heap snapshots as `Timer` or `Timeout` objects. `clearTimeout(t)` is the equivalent of `t.Stop()`. The same anti-patterns exist: timers in loops, forgotten cancellations.

#### Rust

Rust's async runtimes (`tokio`, `async-std`) provide `tokio::time::sleep` and `tokio::time::timeout`. Cancellation is automatic when a future is dropped, so the leak risk is much lower. However, you can still leak if you `tokio::spawn` a task that holds a timer and never gets joined.

#### Erlang/OTP

Erlang's `timer:apply_after` and `erlang:send_after` create timers managed by the BEAM. Cancellation via `erlang:cancel_timer/1`. Cleanup is generally robust because of the share-nothing process model: a dead process's timers are reaped automatically.

#### Lesson

Go's situation is *intermediate*. Cleaner than Java (timer-as-channel is more idiomatic) but messier than Rust (no automatic drop-cleans-resources). The discipline required is moderate: pay attention to lifecycles, use the wrappers, instrument the fleet.

---

### Appendix AF: A Survey of Real Go Codebases

To ground this document, an informal survey of open-source Go codebases. The survey method: take 10 popular Go repositories, run `grep -c "time\.After"`, and characterize the use.

(Note: this is illustrative — specific projects evolve.)

| Project | `time.After` count | In loops? | Risk level |
|---|---|---|---|
| Kubernetes | ~200 | Many | High (mitigated by careful review) |
| Prometheus | ~50 | Few | Low |
| Docker | ~80 | Some | Medium |
| etcd | ~40 | Few | Low |
| Hugo | ~10 | None | Low |
| Terraform | ~60 | Some | Medium |
| gRPC-Go | ~30 | Few | Low |
| influxdb | ~40 | Some | Medium |
| jaeger | ~25 | Few | Low |
| consul | ~50 | Some | Medium |

Even in well-engineered codebases, `time.After` is widespread. Most usages are safe; some are not. The discipline of regular audits is universal.

---

### Appendix AG: A Sample CI Configuration

A complete, working CI configuration for a Go service that enforces timer-leak prevention. This is illustrative; adapt to your team's setup.

```yaml
# .github/workflows/ci.yml
name: ci
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: "1.23"

      - name: Vet
        run: go vet ./...

      - name: Staticcheck
        run: |
          go install honnef.co/go/tools/cmd/staticcheck@latest
          staticcheck ./...

      - name: Custom Lints
        run: |
          go install ./cmd/banafterloop
          go install ./cmd/mustcancel
          banafterloop ./...
          mustcancel ./...

      - name: Test (race + goleak)
        run: go test -race -count=1 ./...

      - name: Test (timer leak)
        run: go test -race -tags=timerleak -count=1 ./...

      - name: Build
        run: go build ./...
```

The two custom lints (`banafterloop`, `mustcancel`) live in `cmd/` directories of the same repo, built and run as part of CI. The `timerleak` build tag selects per-test timer-count assertions in addition to standard tests.

#### Pre-commit Hook

For developers, a pre-commit hook that mirrors CI:

```sh
#!/usr/bin/env bash
# .git/hooks/pre-commit
set -e
go vet ./...
staticcheck ./... 2>&1 || true
go test -race -count=1 ./internal/... ./pkg/...
```

This catches most issues before they reach review.

---

### Appendix AH: Reading the Runtime Source

For engineers who want to understand timer behaviour from first principles, here is a reading guide to the Go runtime source.

#### Files to Read

1. `src/time/sleep.go` — public API: `time.After`, `time.NewTimer`, `Timer.Stop`, `Timer.Reset`.
2. `src/time/tick.go` — `time.Ticker` and `time.Tick`.
3. `src/runtime/time.go` — internal timer types and operations.
4. `src/runtime/proc.go` — scheduler integration (search for `timer`).
5. `src/runtime/checkptr.go` — bookkeeping for timer-channel interactions.

#### Reading Order

1. Start with `src/time/sleep.go`. Read the package comment. Read `NewTimer`. Note that it calls `startTimer` and returns the `*Timer`.
2. Follow `startTimer` into `src/runtime/time.go`. Read the `timer` struct definition. Note the fields: `when`, `period`, `f`, `arg`, `seq`, `nextwhen`, `status`.
3. Read `addtimer`. Note that it inserts into a per-P heap.
4. Read `runOneTimer`. This is the function that actually fires a timer.
5. Read `(*Timer).Stop`. Note how it interacts with the timer's status field.
6. Read `(*Timer).Reset`. Note the pre-1.23 and post-1.23 paths.

Plan to spend 2-3 hours. The code is well-commented but assumes familiarity with the scheduler.

#### What You Will Learn

- The timer heap is a lock-free min-heap per P, not a global structure.
- Timer status is updated with atomics, allowing concurrent `Stop` and fire.
- The runtime's `sysmon` goroutine periodically checks all Ps for due timers; the scheduler also checks on every iteration of the work-stealing loop.
- The relationship between `*time.Timer` (user-facing) and `runtime.timer` (internal) is one-to-one with a pointer.

This level of understanding is not required to operate a Go service safely. But for the engineer who wants to be confident in their mental model — and who may someday contribute a runtime patch — it is foundational.

---

### Appendix AI: The Reverse Problem — Timers That Don't Fire

A short note on the opposite problem: not timer leaks, but timers that fail to fire. This is rarer but worth mentioning because the symptoms can look similar to a leak (operations stuck waiting for a timeout).

Causes of timers not firing:

1. **Pre-1.14 starvation**: the global timer heap could be starved under heavy load. Fixed by per-P heaps.
2. **Long GC pauses**: a stop-the-world GC of 500ms delays all timer fires by up to 500ms.
3. **Process pause** (SIGSTOP, Docker pause, VM suspend): all timers delay until resume.
4. **Clock skew / monotonic clock reset**: extremely rare; happens if the OS or virtualization layer resets the monotonic clock.

If a service appears to be hung on a timeout, capture a stack trace and check what the goroutine is parked on. If it's `selectgo` with a timer wait, the timer should fire within its duration unless one of the above causes intervenes.

In practice, "timers not firing" is almost always a symptom of GC issues. Fix the heap; the timer behaves correctly.

---

### Appendix AJ: Synthesizing a Test Workload

For chaos testing or load testing, you often need to synthesize traffic that exercises timer-heavy code paths. A reusable load generator:

```go
package loadgen

import (
    "context"
    "math/rand"
    "sync"
    "time"
)

// Generator drives a function at a target rate.
type Generator struct {
    fn       func(context.Context)
    rate     float64 // ops/s
    parallel int
}

func New(fn func(context.Context), rate float64, parallel int) *Generator {
    return &Generator{fn: fn, rate: rate, parallel: parallel}
}

func (g *Generator) Run(ctx context.Context) {
    var wg sync.WaitGroup
    for i := 0; i < g.parallel; i++ {
        wg.Add(1)
        go g.worker(ctx, &wg)
    }
    wg.Wait()
}

func (g *Generator) worker(ctx context.Context, wg *sync.WaitGroup) {
    defer wg.Done()
    perWorker := g.rate / float64(g.parallel)
    period := time.Duration(float64(time.Second) / perWorker)
    t := time.NewTimer(period)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            g.fn(ctx)
            jitter := time.Duration(rand.Int63n(int64(period) / 10))
            t.Reset(period + jitter)
        }
    }
}
```

This itself uses a reusable timer to avoid contributing to the leak it's trying to measure.

Usage:

```go
gen := loadgen.New(func(ctx context.Context) {
    suspectedLeakyFunc(ctx)
}, 1000.0, 10) // 1000/s across 10 workers
gen.Run(ctxWithTimeout)
```

Run this for several minutes while collecting heap profiles. Diff the profiles to find the leak.

---

### Appendix AK: Documentation Standard for `time`-Using Code

When you write or review code that uses `time.*` primitives, the code should document its time-related properties. A suggested standard:

```go
// processStream reads from in and writes to out, dropping items if out
// is full for longer than maxWait. processStream owns one timer for its
// lifetime; the timer is stopped on return.
//
// processStream returns when ctx is cancelled or in is closed.
func processStream(ctx context.Context, in <-chan Item, out chan<- Item, maxWait time.Duration) error {
    // ...
}
```

The doc comment names:
1. The maximum time-related resource cost (one timer).
2. The lifecycle guarantee (timer stopped on return).
3. The termination conditions.

A reviewer who reads this comment can verify these claims against the implementation. The discipline of writing such comments often catches leaks at write time, because authors confronted with the question "how many timers does this code own?" tend to think more carefully about ownership.

---

### Appendix AL: Final Reflection

Timer leaks are a particularly Go-specific class of bug. They emerge from the language's flexibility (channels, goroutines, easy concurrency) combined with the runtime's design choices (timer-as-channel, per-P heaps, GC roots). They are mostly absent from languages with explicit destructors (Rust) or single-threaded event loops (Node, prior to worker_threads).

The discipline of preventing them is therefore distinctively Go-flavoured: code reviews, lifecycle ownership, lifecycle documentation, lifecycle metrics, lifecycle linting. None of these are revolutionary, but together they form a coherent practice.

If your team takes this document seriously and implements its recommendations, you will reduce your timer-leak incidents by an order of magnitude or more. Some leaks will still slip through — software is imperfect — but the response will be faster, the impact smaller, and the lessons institutional rather than personal.

The remaining work is the long arc of every engineering discipline: training new engineers, maintaining the linters, updating the docs, retiring the runbook items that are no longer needed. There is no permanent solution. But the cost of vigilance is small compared to the cost of an outage.

Build the infrastructure once. Maintain it. Move on. The next class of bug will arrive soon enough.

---

### Appendix AM: A Deeper Dive into `runtime/metrics` for Timer Diagnostics

The `runtime/metrics` package, introduced in Go 1.16 and steadily expanded since, is the most powerful built-in surface for observing the runtime's internal state. While there is no single metric named "live timers" in any Go version up to 1.23, several metrics together let you triangulate.

#### Relevant Metrics

The full list of metrics is discoverable at runtime:

```go
import "runtime/metrics"

descs := metrics.All()
for _, d := range descs {
    fmt.Printf("%s [%s] %s\n", d.Name, d.Kind, d.Description)
}
```

A typical Go 1.22 output includes:

```
/cgo/go-to-c-calls:calls [counter] Count of calls made from Go to C
/cpu/classes/gc/mark/assist:cpu-seconds [counter] Estimated total CPU time goroutines spent...
/cpu/classes/gc/mark/dedicated:cpu-seconds [counter] Estimated total CPU time spent in...
/cpu/classes/gc/mark/idle:cpu-seconds [counter] Estimated total CPU time spent...
/cpu/classes/gc/pause:cpu-seconds [counter] Estimated total CPU time spent...
/cpu/classes/gc/total:cpu-seconds [counter] Estimated total CPU time spent in GC...
/cpu/classes/idle:cpu-seconds [counter] Estimated total available CPU time...
/cpu/classes/scavenge/assist:cpu-seconds [counter] ...
/gc/cycles/automatic:gc-cycles [counter] Count of completed GC cycles generated automatically
/gc/cycles/forced:gc-cycles [counter] Count of completed GC cycles forced by the application
/gc/cycles/total:gc-cycles [counter] Count of all completed GC cycles
/gc/heap/allocs:bytes [counter] Cumulative sum of memory allocated to the heap
/gc/heap/allocs:objects [counter] Cumulative count of heap allocations
/gc/heap/allocs-by-size:bytes [distribution] Distribution of heap allocations by approximate size
/gc/heap/frees:bytes [counter] Cumulative sum of heap memory freed by GC
/gc/heap/frees:objects [counter] Cumulative count of heap allocations freed
/gc/heap/goal:bytes [gauge] Heap size target for next GC cycle
/gc/heap/objects:objects [gauge] Number of objects, live or allocated
/gc/heap/tiny/allocs:objects [counter] Count of small objects allocated together in tiny allocation regions
/gc/pauses:seconds [distribution] Distribution of individual GC-related stop-the-world pause latencies
/sched/goroutines:goroutines [gauge] Count of live goroutines
/sched/latencies:seconds [distribution] Distribution of the time goroutines spent in the scheduler before running
```

For timer diagnostics, the most useful are:
- `/gc/heap/objects:objects` — live object count
- `/sched/goroutines:goroutines` — live goroutine count
- `/sched/latencies:seconds` — scheduler delay distribution
- `/gc/pauses:seconds` — GC pause distribution

#### Computing Derived Signals

A useful signal is `live_objects / live_goroutines`. If this ratio drifts upward over time, you have an object leak that is not goroutine-paired — strongly suggestive of timer or cache leaks.

```go
func TimerSuspicionRatio() float64 {
    samples := []metrics.Sample{
        {Name: "/gc/heap/objects:objects"},
        {Name: "/sched/goroutines:goroutines"},
    }
    metrics.Read(samples)
    objs := float64(samples[0].Value.Uint64())
    gorout := float64(samples[1].Value.Uint64())
    if gorout == 0 {
        return 0
    }
    return objs / gorout
}
```

Export this as a gauge. A baseline value for a healthy service is typically in the hundreds (objects per goroutine). Drift to thousands per goroutine is a leak signal.

#### Scheduler Latency Histogram

`/sched/latencies:seconds` is a histogram of how long goroutines wait in the runnable queue before being scheduled. Rising tail latencies here correlate with rising GC pause times, which in turn correlate with rising heap (possibly from timer leaks).

```go
func ScheduleLatencyP99() float64 {
    samples := []metrics.Sample{
        {Name: "/sched/latencies:seconds"},
    }
    metrics.Read(samples)
    hist := samples[0].Value.Float64Histogram()
    total := uint64(0)
    for _, c := range hist.Counts {
        total += c
    }
    target := uint64(float64(total) * 0.99)
    seen := uint64(0)
    for i, c := range hist.Counts {
        seen += c
        if seen >= target {
            return hist.Buckets[i+1]
        }
    }
    return 0
}
```

Export as a histogram or as the p99 gauge. Drift upward correlates with overall scheduler stress.

---

### Appendix AN: Profiling in Restricted Environments

Some production environments do not allow direct access to pprof endpoints. This appendix covers strategies for those cases.

#### Strategy 1: Profile-and-Ship

If the pod can write to a network volume or object store, have it periodically dump profiles and ship them:

```go
package profiler

import (
    "bytes"
    "context"
    "fmt"
    "runtime/pprof"
    "time"

    "github.com/aws/aws-sdk-go/aws"
    "github.com/aws/aws-sdk-go/service/s3"
)

type S3Profiler struct {
    bucket   string
    keyTpl   string
    client   *s3.S3
    interval time.Duration
}

func (p *S3Profiler) Run(ctx context.Context) {
    t := time.NewTicker(p.interval)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            if err := p.dump(); err != nil {
                // log and continue
            }
        }
    }
}

func (p *S3Profiler) dump() error {
    var buf bytes.Buffer
    if err := pprof.Lookup("heap").WriteTo(&buf, 0); err != nil {
        return err
    }
    key := time.Now().UTC().Format(p.keyTpl)
    _, err := p.client.PutObject(&s3.PutObjectInput{
        Bucket: aws.String(p.bucket),
        Key:    aws.String(key),
        Body:   bytes.NewReader(buf.Bytes()),
    })
    return err
}

func main() {
    _ = fmt.Sprintf // illustrative only
}
```

Profiles accumulate in S3. The investigator pulls them down for offline analysis.

#### Strategy 2: Trigger by Signal

If the operator can `kill -SIGUSR1` the process, install a signal handler that dumps a profile:

```go
import (
    "os"
    "os/signal"
    "runtime/pprof"
    "syscall"
)

func init() {
    ch := make(chan os.Signal, 1)
    signal.Notify(ch, syscall.SIGUSR1)
    go func() {
        for range ch {
            f, err := os.Create(fmt.Sprintf("/tmp/heap-%d.pb.gz", time.Now().Unix()))
            if err != nil {
                continue
            }
            pprof.Lookup("heap").WriteTo(f, 0)
            f.Close()
        }
    }()
}
```

Operators trigger a profile by sending the signal; profile lands in `/tmp` (or wherever you configure).

#### Strategy 3: In-Process Analysis

If even file IO is restricted, you can analyze profiles in-process:

```go
import (
    "github.com/google/pprof/profile"
    "bytes"
    "runtime/pprof"
)

func TopTimerAllocators() ([]string, error) {
    var buf bytes.Buffer
    if err := pprof.Lookup("heap").WriteTo(&buf, 0); err != nil {
        return nil, err
    }
    p, err := profile.Parse(&buf)
    if err != nil {
        return nil, err
    }
    var top []string
    for _, sample := range p.Sample {
        for _, loc := range sample.Location {
            for _, line := range loc.Line {
                if strings.Contains(line.Function.Name, "time.NewTimer") ||
                    strings.Contains(line.Function.Name, "time.After") {
                    top = append(top, line.Function.Name)
                }
            }
        }
    }
    return top, nil
}
```

The returned list shows allocation stacks that include timer-creation symbols. Export this as a log line or metric.

---

### Appendix AO: A Note on Containers and `cgroup` Memory Limits

When running in containers with `cgroup` memory limits, a timer leak's progression is different from a leak in an unrestricted environment.

#### What Happens at the Limit

When a process approaches its `cgroup` memory limit:

1. The kernel begins reclaiming memory aggressively.
2. Page cache is dropped, then anonymous memory pages are paged out (if swap exists, which it usually doesn't in containers).
3. The OOM killer activates and kills the process.

For a Go process, the practical signal is: `kubectl describe pod` shows "OOMKilled" exit reason. There is no graceful degradation, no warning, no chance for the program to dump diagnostics.

#### `GOMEMLIMIT`

Go 1.19 added the `GOMEMLIMIT` environment variable, which tells the runtime to target a soft memory limit. When set, the runtime adjusts GC aggressiveness to keep total memory under the limit, even at the cost of higher CPU.

```sh
GOMEMLIMIT=1GiB go run myapp
```

Set this to ~90% of your `cgroup` limit. The runtime will GC more aggressively as you approach the limit, which gives you a chance to detect the leak before OOM.

Caveat: aggressive GC under memory pressure can produce thrashing. If your service is leaking and `GOMEMLIMIT` is preventing OOM, GC CPU may rise to 30-50% before the process eventually crashes. The end result is a slow, painful degradation rather than a sudden death — neither is ideal, but the slow death gives operators more time to react.

#### Implications for Leak Investigation

In containerized environments:
- The leak will not produce a slow heap drift visible over weeks. The process will OOM within days or hours.
- Pod restart counts become a leak signal. A pod that restarts every few hours is leaking.
- Memory-limit-relative metrics (e.g., `container_memory_usage_bytes / container_spec_memory_limit_bytes`) are useful.

#### Detecting Leaks Through Restart Patterns

```yaml
- alert: PodOOMRestartLoop
  expr: |
    increase(kube_pod_container_status_restarts_total{reason="OOMKilled"}[1h]) > 3
  labels:
    severity: critical
```

If a pod OOM-kills more than 3 times an hour, it is leaking memory rapidly. Heap profile *before* the next OOM (if possible) will identify the cause.

---

### Appendix AP: Profile Sampling and Statistical Confidence

The Go heap profile is *sampled*: by default, one allocation per ~512 KiB is recorded with its full stack. This means small, frequent allocations are under-represented relative to large, rare allocations of the same total volume.

For timer leak debugging, this can mislead:

- A timer is ~250 bytes; the sampling rate is 1 per 512 KiB. So roughly 1 in 2,000 timer allocations is sampled.
- A leak of 10,000 timers shows ~5 samples in the profile.
- A leak of 1,000 timers shows ~0-1 samples — possibly invisible.

#### Increasing Sampling for Investigation

Set `MemProfileRate` higher (a smaller number means more samples):

```go
import "runtime"

func init() {
    runtime.MemProfileRate = 1024 // 1 sample per 1 KiB
}
```

This gives 500× more samples but costs proportionally more CPU and memory. Use only in development or when actively investigating.

#### Confidence Intervals

The relative uncertainty in a profile bucket is approximately `1 / sqrt(samples)`. With 100 samples, uncertainty is ~10%. With 10 samples, uncertainty is ~30%. With 1 sample, uncertainty is meaningless.

Practical guideline: don't trust profile buckets with fewer than 10 samples for leak attribution. If your leak is small, you may need to wait longer (let more timers accumulate) before profiling, or set `MemProfileRate` higher.

#### Profile-Time-Window Tradeoff

A profile reflects the current state of the heap. For a service that recently restarted, the profile may not yet show the leak's accumulated state. Wait for the heap to grow at least 2× over baseline before profiling, to ensure the leak has had time to dominate.

---

### Appendix AQ: An End-to-End Story — From Suspicion to Permanent Fix

This appendix tells the story of one team's six-month journey from "we think we have timer leaks somewhere" to "we are confident our services are timer-leak-free." It is intended as a model for teams undertaking similar initiatives.

#### Month 1: Suspicion

The team had three Go services in production. All three had heap that drifted upward over days. Pods were restarted weekly as a maintenance pattern. The pattern was normalized; nobody had investigated.

A new engineer joined the team and asked, "Why do you restart pods every week?" The answer was, "Because the heap grows." They asked, "Why does the heap grow?" The answer was, "We don't know."

The new engineer's first project: find out why.

#### Month 2: Initial Diagnostics

The engineer added `runtime/metrics` exporters to all three services. After two weeks of data, the chart was clear: all three services had positive heap slope, around 5-15 MB/day each.

They took heap profiles. Two of the three services showed `time.NewTimer` in the top 5 allocators. The third showed `strings.Builder` — a different kind of leak, deferred for later.

#### Month 3: First Fixes

The engineer audited timer usage in the two affected services. They found:

- Service A: 14 uses of `time.After`, 3 in `for` loops (all leaks).
- Service B: 22 uses of `time.After`, 7 in `for` loops (all leaks).

They fixed the leaks one PR at a time, with each PR including a regression test using `goleak.VerifyNone`. The fixes took two weeks.

After the fixes, both services showed flat heap. Pod restarts every week were no longer necessary; the team set restart frequency to monthly as a hygiene measure rather than a workaround.

#### Month 4: Prevention

With the immediate leaks fixed, the engineer turned to prevention. They:

1. Wrote a custom linter (`banafterloop`) and integrated it into CI.
2. Wrote the `timed` wrapper package and updated team docs to prefer it.
3. Added `go_live_timers` metric to all three services.
4. Wrote dashboards showing per-service timer counts.
5. Added alerts for timer count growth.

#### Month 5: Education

The engineer wrote a team wiki page on "Working with Time in Go" covering:

- The leak patterns to avoid.
- The wrapper APIs to prefer.
- The CI rules that enforce them.
- The dashboards and alerts that detect leaks.

They presented the wiki at a team meeting and answered questions. Over the following weeks, they reviewed every timer-related PR and explained the rules in code review comments.

#### Month 6: Validation

The engineer designed and ran chaos tests for each service:

- Service A: simulate doubled traffic for one hour; verify heap remains bounded.
- Service B: simulate upstream flapping every 30 seconds for one hour; verify heap remains bounded.
- Service C (the strings-builder leak service): different problem, handled separately.

All tests passed. The team declared the timer-leak retrofit complete.

#### Outcome

Six months later:

- No timer-leak incidents in any of the three services.
- Pod restart frequency reduced from weekly to never (other than deploys).
- Memory budget per pod reduced by 30%, allowing higher density.
- Team confidence in long-running services increased.

The cost of the retrofit was approximately six months of one engineer's attention (not full time — perhaps 30% of their time, with the rest spent on other duties). The payoff was permanent.

#### Lessons for Other Teams

1. **Start with diagnostics, not fixes.** The data shows you what's actually leaking.
2. **Fix one leak at a time.** Don't try to refactor everything at once; each fix should be a small, verifiable PR.
3. **Build prevention infrastructure alongside fixes.** Linters and metrics outlast the original effort.
4. **Education matters more than tooling.** The wiki page and the code reviews shifted the team's habits permanently.
5. **Chaos tests validate.** Without them, you can't be confident the leaks are gone.

This story is composite — drawn from several real teams — but every element of it has happened in practice. Your team's journey may differ in detail; the structure is general.

---

### Appendix AR: When to Tolerate a Timer Leak

Most of this document treats timer leaks as bugs to be fixed. But there are situations where a small, bounded "leak" is acceptable and the engineering cost of fixing it is greater than the operational cost of carrying it. This appendix lists such situations.

#### Situation 1: Process-Lifetime Timers

A timer that exists for the program's entire lifetime is not, strictly speaking, leaked. It is intentional. Examples:

```go
package main

import "time"

var startupTime = time.Now()

func main() {
    // A single ticker driving a periodic metric flush, for program lifetime.
    t := time.NewTicker(time.Minute)
    go func() {
        for range t.C {
            flushMetrics()
        }
    }()
    // t.Stop() is never called because the program never exits.
    serve()
}
```

This is fine. The ticker exists for the program's life and stops only when the process dies.

#### Situation 2: Short-Lived Subprograms

A test binary or one-off CLI tool that runs for seconds may leak timers without consequence:

```go
func main() {
    if _, err := http.Get("https://example.com"); err != nil {
        log.Fatal(err)
    }
    // Many timers may be left over inside net/http internals.
    // The process exits in seconds.
}
```

Fix only if you have specific reasons (e.g., you're running this code inside a long-lived parent process). Otherwise, ignore.

#### Situation 3: Single-Allocation, Short-Duration Timers

```go
func handleRequest(w http.ResponseWriter, r *http.Request) {
    ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
    defer cancel()
    // ... use ctx ...
}
```

Even if `cancel` is called *only* via `defer`, the timer is reachable through the context until the handler returns. If the handler completes in 50ms, the timer is "leaked" for 4.95 seconds before being collected. This is fine. The cost is bounded, the pattern is idiomatic, and fixing it would require more code than it's worth.

#### Situation 4: Bounded Concurrent Operations

```go
func performBatch(items []Item) {
    sem := make(chan struct{}, 10)
    var wg sync.WaitGroup
    for _, item := range items {
        sem <- struct{}{}
        wg.Add(1)
        go func(it Item) {
            defer func() { <-sem; wg.Done() }()
            ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
            defer cancel()
            process(ctx, it)
        }(item)
    }
    wg.Wait()
}
```

Up to 10 concurrent timers from `WithTimeout`. The total live count is bounded by the semaphore. No leak.

#### When to Investigate Anyway

Even in "tolerable" situations, investigate if:
- The pattern is in a hot path (millions of timer ops/s).
- You're running on Go ≤ 1.20 with restrictive memory limits.
- You're seeing GC pause drift correlated with the code path.

Otherwise, accept the small cost and move on.

---

### Appendix AS: A Field Guide to Common Symptoms

Six characteristic patterns, each linked to its most likely cause.

#### Pattern A: Linear Heap Growth, Flat Goroutines

Most likely: timer leak via `time.After` in a hot loop, or `context.WithTimeout` with discarded cancel.

Diagnostic: heap profile shows `time.NewTimer` or `time.startTimer` dominant.

#### Pattern B: Linear Heap Growth, Linear Goroutines

Most likely: goroutine leak that includes timers (paired leak).

Diagnostic: goroutine profile shows growing count for a single stack; heap profile shows `time.NewTimer` *and* whatever the goroutine is constructing.

#### Pattern C: Heap Spike on Each Burst, Recovers Slowly

Most likely: many short-lived timers allocated per burst, GC eventually cleaning up.

Diagnostic: allocation profile (`alloc_objects`) shows high `time.NewTimer` rate; inuse profile shows lower count.

#### Pattern D: Heap Grows During Incidents, Recovers During Health

Most likely: reconnect-loop pattern — timers allocated on retry attempts, cleaned up when upstream recovers.

Diagnostic: correlate heap growth with upstream health; check reconnect code paths.

#### Pattern E: Heap Flat, GC Pause Drifts Upward

Most likely: many small allocations stressing the GC's mark phase. Could include timers but not necessarily.

Diagnostic: `runtime/metrics` `/gc/pauses:seconds` distribution; correlate with allocation rate.

#### Pattern F: Latency Drift Without Heap Drift

Most likely: GC issue from large allocations (caches, slices) rather than timers. Or scheduler latency from too many goroutines.

Diagnostic: `runtime/metrics` `/sched/latencies:seconds`; allocation profile.

---

### Appendix AT: Closing Words

The Go runtime is a remarkably engineered system. Its concurrency primitives are usable enough that ordinary programmers can write parallel programs without ceremony, and powerful enough that the same primitives compose into high-performance services handling millions of requests per second. Most of this works because the runtime is careful, conservative, and predictable.

But every abstraction leaks. The timer abstraction leaks specifically into memory: the runtime cannot know when *your* code is finished with a timer; it can only respect the lifecycle signals you give it. When you forget to give those signals, the runtime keeps the timer alive — that is its job — and the memory accumulates.

The discipline of not leaking timers is the discipline of remembering whose responsibility it is to clean up. The Go runtime gives you the tools; it does not enforce their use. Linters, wrappers, and metrics are how we substitute mechanical enforcement for forgetful humans. They are not optional infrastructure. For any service that runs for more than a few hours, they are as essential as logging and authentication.

Build them. Maintain them. Inspect their output regularly. Train your team to use them.

The result is a Go service that you can leave running for months without worry. Whose memory profile is flat, whose latency profile is consistent, whose pod restart count is zero. Whose operator on-call rotation is bored. That is the highest praise a long-running service can earn.

---

End of professional document.



