# Runtime Goroutine Management — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Architecting Profiling Labels](#architecting-profiling-labels)
3. [pprof.SetGoroutineLabels in Depth](#pprofsetgoroutinelabels-in-depth)
4. [Label Propagation Rules](#label-propagation-rules)
5. [Continuous Profiling Pipelines](#continuous-profiling-pipelines)
6. [runtime/trace Analysis](#runtimetrace-analysis)
7. [Building a runtime/metrics Adapter](#building-a-runtimemetrics-adapter)
8. [Adaptive GOMEMLIMIT](#adaptive-gomemlimit)
9. [Designing Diagnostic Endpoints](#designing-diagnostic-endpoints)
10. [SetCgoTraceback for Cgo Crashes](#setcgotraceback-for-cgo-crashes)
11. [Capacity-Planning Inputs from the Runtime](#capacity-planning-inputs-from-the-runtime)
12. [Self-Assessment](#self-assessment)
13. [Summary](#summary)

---

## Introduction

At middle level you set `GOMAXPROCS` and `GOMEMLIMIT`, integrated `runtime/metrics` into Prometheus, and learned to take profile dumps. At senior level you design the *systems* that turn runtime APIs into operational insight: continuous profiling, label-aware sampling, adaptive tuning, and trace-driven root-cause analysis.

After this file you will:

- Use `pprof.SetGoroutineLabels` and `pprof.Do` to build label-aware sampling middleware.
- Understand exactly how labels propagate (and where they leak).
- Capture and analyse `runtime/trace` output to find scheduler stalls, GC interference, and goroutine starvation.
- Build adaptive `GOMEMLIMIT` controllers that respond to cgroup pressure events.
- Design `/debug` endpoints that are safe to expose in production behind auth.
- Read `SetCgoTraceback` and integrate native-stack symbolization.
- Translate runtime metrics into capacity-planning numbers.

Cross-reference: the GC pacer internals belong to the garbage collector section; the scheduler internals belong to the scheduler section. Here we focus on what senior application engineers can build using the runtime's exposed APIs.

---

## Architecting Profiling Labels

A profile without context is a heat map of function names. Labels turn it into a story: "these CPU cycles belong to tenant X, request Y, endpoint Z." At senior level, labels are not optional flavour — they are the spine of production debugging.

### What you get with labels

- **CPU profile slicing.** `go tool pprof -tagfocus=tenant=acme cpu.pprof` shows only frames from goroutines that ran with `tenant=acme`.
- **Trace filtering.** `go tool trace` lets you isolate goroutines by label.
- **Mutex/block profile correlation.** Same label slicing applies.
- **Heap profile correlation.** Labels appear on allocations sampled inside the labeled scope.

### What you don't get

- **Goroutine profile labels are limited.** The `goroutine` profile (lookup `"goroutine"`) is grouped by creation stack, not by labels. To slice goroutine *counts* by label, you build it yourself with `runtime/metrics` plus a custom counter.
- **No retroactive labels.** A goroutine that was already running when you set a label keeps its old labels for spawned children — wait, this is wrong, see [Label Propagation Rules](#label-propagation-rules). The label change *does* take effect for new children, not for already-spawned ones.

### Label conventions

Use stable, low-cardinality keys. Examples:

- `tenant` — tenant ID. Always low cardinality on multi-tenant servers.
- `endpoint` — route name, not full URL. Keep cardinality bounded.
- `request_kind` — `read`, `write`, `bulk`. Categorical, not unique.
- `priority` — `interactive`, `background`.

Avoid:

- `request_id` — high cardinality. Use only for short-lived investigative profiling.
- `user_id` — both high cardinality and a privacy concern.
- Anything containing tokens or secrets.

---

## pprof.SetGoroutineLabels in Depth

### Two APIs

```go
// Low level
pprof.SetGoroutineLabels(ctx context.Context)

// High level
pprof.Do(ctx context.Context, labels LabelSet, f func(context.Context))
```

`SetGoroutineLabels` reads labels *from the supplied context* and attaches them to the calling goroutine, *replacing* any previous labels. Counterintuitive: it does not merge with existing labels.

`Do` is the safer wrapper: it saves the previous labels, merges the new ones, calls `f` with an updated context, then restores the previous labels on return.

### Context-carrying labels

Labels live in the context via `pprof.WithLabels`:

```go
ctx := pprof.WithLabels(parent, pprof.Labels("tenant", "acme"))
pprof.SetGoroutineLabels(ctx)
```

`pprof.Labels(k1, v1, k2, v2, ...)` returns a `LabelSet`. It panics if called with an odd number of arguments.

### Minimal middleware

```go
func ProfileLabels(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        labels := pprof.Labels(
            "endpoint", routeName(r),
            "method",   r.Method,
        )
        pprof.Do(r.Context(), labels, func(ctx context.Context) {
            next.ServeHTTP(w, r.WithContext(ctx))
        })
    })
}
```

Every request handler now runs with labels attached. Child goroutines spawned inside the handler inherit them at spawn time.

### Manual label scope

```go
func backgroundJob(jobID string) {
    ctx := pprof.WithLabels(context.Background(),
        pprof.Labels("job", "billing", "id", jobID))
    pprof.SetGoroutineLabels(ctx)
    defer pprof.SetGoroutineLabels(context.Background()) // clear
    runJob()
}
```

Be deliberate about clearing labels when the labeled scope ends. Otherwise the labels persist on the goroutine forever (or until the goroutine exits).

### Reading current labels

```go
pprof.ForLabels(ctx, func(key, value string) bool {
    fmt.Println(key, "=", value)
    return true
})
```

`ForLabels` walks the labels stored in the *context*, not the labels currently set on the goroutine. For the goroutine's labels, the public API is essentially read-only via profile output.

---

## Label Propagation Rules

### Goroutine inheritance

When goroutine A spawns goroutine B (`go child()`), B inherits A's *current* labels at the moment of `go`. Later changes to A's labels do not propagate to B.

```go
pprof.SetGoroutineLabels(ctx) // ctx has tenant=acme
go child() // child has tenant=acme

pprof.SetGoroutineLabels(other) // ctx has tenant=widgets
go anotherChild() // has tenant=widgets

// child still has tenant=acme
```

### `pprof.Do` semantics

```go
pprof.Do(ctx, pprof.Labels("a", "1"), func(ctx context.Context) {
    // inside Do: labels = parent ∪ {a=1}
    pprof.Do(ctx, pprof.Labels("b", "2"), func(ctx context.Context) {
        // labels = parent ∪ {a=1, b=2}
    })
    // labels back to parent ∪ {a=1}
})
// labels back to parent
```

Labels are saved and restored on each scope. This makes nested labelling safe.

### Context vs goroutine state

There are two stores of labels:

1. **The context value** — what `pprof.WithLabels` and `pprof.ForLabels` see.
2. **The goroutine's runtime label set** — what profile sampling sees, set by `pprof.SetGoroutineLabels`.

These are not automatically in sync. `pprof.Do` keeps them in sync by setting both. If you use `SetGoroutineLabels` manually with a context that has different `WithLabels` values, profiling reflects the goroutine's labels, but `ForLabels` returns the context's. Avoid this divergence; use `pprof.Do` whenever possible.

### Cross-process boundaries

Labels do not propagate through RPC, queue, or any channel-based hand-off. If a worker goroutine pulls a job from a channel, it must set its own labels based on the job. Build a small helper:

```go
type Job struct {
    Labels pprof.LabelSet
    Work   func(ctx context.Context)
}

func consume(jobs <-chan Job) {
    for j := range jobs {
        pprof.Do(context.Background(), j.Labels, j.Work)
    }
}
```

### Leak: labels persist past their scope

If you call `SetGoroutineLabels` and the goroutine outlives the logical scope, the labels stick. Symptom: profile output shows long-running background goroutines tagged with whatever the last labeled scope was.

Fix: always end labeled scopes with `pprof.SetGoroutineLabels(context.Background())` or use `pprof.Do`.

---

## Continuous Profiling Pipelines

A single ad-hoc `go tool pprof` capture during an incident is reactive. Senior teams run continuous profiling: a sampler that takes a short profile every minute, ships it to a backend (Pyroscope, Parca, Grafana Cloud Profiles, Google Cloud Profiler), and indexes by labels.

### Architecture

```
[ Go service ]
     |
     | scheduled (every 60s)
     v
[ profile collector ]
   - CPU profile (10s window)
   - heap profile (snapshot)
   - goroutine profile (snapshot)
   - mutex profile (if fraction > 0)
   - block profile (if fraction > 0)
     |
     | HTTP POST with labels
     v
[ profile backend ]
   - per-service index
   - per-tenant slice
   - flamegraphs over time
```

### Minimal in-process collector

```go
func runProfiler(ctx context.Context, post func([]byte, map[string]string)) {
    t := time.NewTicker(time.Minute)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            var buf bytes.Buffer
            if err := pprof.StartCPUProfile(&buf); err == nil {
                time.Sleep(10 * time.Second)
                pprof.StopCPUProfile()
                post(buf.Bytes(), map[string]string{
                    "type":    "cpu",
                    "service": "checkout-api",
                })
            }
        }
    }
}
```

This is the rough shape of what Parca's agent does. Use the agent rather than rolling your own; the value is in the labels and the storage.

### Sampling cost

A 10-second CPU profile costs ~0.1% additional CPU (one sample per OS thread per 10 ms). Affordable to run continuously. Heap and goroutine snapshots cost a brief stop-the-world; keep their cadence at ~1 minute.

Mutex and block profiles cost per-event. With `SetMutexProfileFraction(5)` you sample 20% of contention events — fine for low-contention services, expensive for high-contention ones. Tune per service.

### Labels in continuous profiles

Continuous profilers index by the labels recorded *in the profile*. So your `pprof.Do` middleware does double duty: it makes the profile useful at incident time and at trend time. A continuous profile dashboard might let you ask "show me CPU growth for tenant=acme over the last 7 days." That is only possible because the goroutines were labeled at request time.

---

## runtime/trace Analysis

A trace captures every goroutine state transition, GC event, syscall, and netpoller event. The output viewer (`go tool trace`) is the most powerful debugging tool the runtime offers.

### Capturing

```go
import "runtime/trace"

func captureTrace(seconds int) ([]byte, error) {
    var buf bytes.Buffer
    if err := trace.Start(&buf); err != nil {
        return nil, err
    }
    time.Sleep(time.Duration(seconds) * time.Second)
    trace.Stop()
    return buf.Bytes(), nil
}
```

Production endpoint pattern (behind auth):

```go
mux.HandleFunc("/debug/trace", func(w http.ResponseWriter, r *http.Request) {
    sec, _ := strconv.Atoi(r.URL.Query().Get("seconds"))
    if sec <= 0 || sec > 60 { sec = 5 }
    w.Header().Set("Content-Type", "application/octet-stream")
    w.Header().Set("Content-Disposition", "attachment; filename=trace.out")
    if err := trace.Start(w); err != nil {
        http.Error(w, err.Error(), 500)
        return
    }
    time.Sleep(time.Duration(sec) * time.Second)
    trace.Stop()
})
```

Cost: 5–20% CPU overhead while tracing, plus disk/bandwidth for the output (~50–500 MB for a 10-second trace on a busy server).

### Reading

```
go tool trace trace.out
```

Opens a browser. Tabs:

- **Goroutines.** Per-creation-site count of goroutines, with timeline. Find your hot paths.
- **Network blocking profile.** Where goroutines blocked on network I/O.
- **Synchronization blocking profile.** Where goroutines blocked on channels/mutexes.
- **Syscall blocking profile.** Where goroutines blocked on syscalls.
- **Scheduler latency profile.** Where goroutines were runnable but not running.
- **User-defined tasks and regions.** From `runtime/trace.NewTask`, `trace.WithRegion`.

### Annotating

Manual annotation makes traces actionable:

```go
import "runtime/trace"

ctx, task := trace.NewTask(ctx, "handle_request")
defer task.End()

trace.WithRegion(ctx, "db_query", func() {
    rows, _ := db.QueryContext(ctx, "...")
    rows.Close()
})

trace.Log(ctx, "tenant", "acme")
```

Now the trace viewer shows your tasks as named bars. You can ask "which `handle_request` tasks took > 100 ms" and jump to the goroutines responsible.

### Common patterns to recognise

- **Long horizontal bars on the GC track.** Stop-the-world pauses. If > 1 ms, investigate.
- **Many goroutines stuck on `chan recv` or `chan send`.** A single bottleneck channel. Often a worker pool inversion.
- **Sched-latency spikes after GC.** Many goroutines wake up at once after GC, scheduler oversubscribed for a moment.
- **Network blocking with no corresponding netpoller wake.** A dropped epoll event (rare; usually a custom fd not registered).
- **Tasks that span hundreds of ms with one short region.** The rest of the time is unaccounted — usually scheduling or waiting on locks.

### When NOT to use trace

For pure CPU profiling, use pprof CPU profile — it is cheaper. For "is the GC pausing too much," use `runtime/metrics`. Reserve trace for "I don't understand why this is slow" investigations.

---

## Building a runtime/metrics Adapter

You will write this once and reuse it across services.

### Goals

- Pull a fixed set of metrics.
- Convert each to a Prometheus metric.
- Re-read every N seconds.
- Allow histogram metrics to feed Prometheus histograms.

### Implementation sketch

```go
package goruntimemetrics

import (
    "runtime/metrics"
    "github.com/prometheus/client_golang/prometheus"
)

type Exporter struct {
    samples []metrics.Sample
    gauges  map[string]prometheus.Gauge
    hists   map[string]prometheus.Histogram
}

func New(reg prometheus.Registerer, names []string) *Exporter {
    e := &Exporter{
        samples: make([]metrics.Sample, len(names)),
        gauges:  make(map[string]prometheus.Gauge),
        hists:   make(map[string]prometheus.Histogram),
    }
    for i, n := range names {
        e.samples[i].Name = n
    }
    metrics.Read(e.samples) // initialize, also reveals Kind
    for _, s := range e.samples {
        switch s.Value.Kind() {
        case metrics.KindUint64, metrics.KindFloat64:
            g := prometheus.NewGauge(prometheus.GaugeOpts{Name: clean(s.Name)})
            e.gauges[s.Name] = g
            reg.MustRegister(g)
        case metrics.KindFloat64Histogram:
            h := prometheus.NewHistogram(prometheus.HistogramOpts{
                Name:    clean(s.Name),
                Buckets: s.Value.Float64Histogram().Buckets,
            })
            e.hists[s.Name] = h
            reg.MustRegister(h)
        }
    }
    return e
}

func (e *Exporter) Scrape() {
    metrics.Read(e.samples)
    for _, s := range e.samples {
        switch s.Value.Kind() {
        case metrics.KindUint64:
            e.gauges[s.Name].Set(float64(s.Value.Uint64()))
        case metrics.KindFloat64:
            e.gauges[s.Name].Set(s.Value.Float64())
        case metrics.KindFloat64Histogram:
            // Prometheus histograms accumulate; we use approximate
            // p99 here to feed a summary instead.
        }
    }
}

func clean(name string) string {
    // /sched/goroutines:goroutines -> go_sched_goroutines
    ...
}
```

In practice the official `prometheus/collectors.NewGoCollector(WithGoRuntimeMetricsCollection)` does this for you. The value of writing it once is *understanding what is happening*; in production use the official collector.

---

## Adaptive GOMEMLIMIT

### Motivation

A static `GOMEMLIMIT` is fine in stable conditions. In bursty workloads, you want the cap to flex: tight under memory pressure, loose otherwise. The runtime cannot do this for you because it doesn't know the host's memory pressure.

### Source: cgroup pressure

Linux exposes Pressure Stall Information (PSI) at `/proc/pressure/memory`:

```
some avg10=0.42 avg60=0.13 avg300=0.04 total=2310
full avg10=0.00 avg60=0.00 avg300=0.00 total=0
```

`some` means "some tasks are blocked on memory." Rising values indicate the host is under memory pressure even if your container is not.

### Adapter

```go
func runMemoryAdapter(ctx context.Context, baseMB int64) {
    ticker := time.NewTicker(10 * time.Second)
    defer ticker.Stop()
    current := baseMB
    for {
        select {
        case <-ctx.Done():
            return
        case <-ticker.C:
            psi := readPSI("/proc/pressure/memory") // implement
            target := baseMB
            switch {
            case psi.SomeAvg10 > 5.0:
                target = baseMB * 80 / 100
            case psi.SomeAvg10 < 1.0:
                target = baseMB
            }
            if target != current {
                debug.SetMemoryLimit(target << 20)
                current = target
            }
        }
    }
}
```

The runtime accepts `SetMemoryLimit` calls at any time. Lowering it triggers GC sooner.

### Caveats

- Do not set wildly varying limits — the GC pacer needs stable targets.
- Never let the adapter set a limit lower than your working set; you create a GC death spiral.
- Add a floor (e.g. never below 60% of `baseMB`).
- Log every change.

---

## Designing Diagnostic Endpoints

### What to expose

A minimal `/debug` surface for production:

```go
mux.Handle("/debug/pprof/", http.DefaultServeMux)            // standard pprof
mux.HandleFunc("/debug/stacks", stacksHandler)               // all goroutine stacks
mux.HandleFunc("/debug/metrics", metricsTextHandler)         // runtime/metrics in text
mux.HandleFunc("/debug/gc", gcHandler)                       // force GC, return stats
mux.HandleFunc("/debug/trace", traceHandler)                 // runtime/trace capture
mux.HandleFunc("/debug/labels", currentLabelsHandler)        // for debugging your own labels
```

### Authentication

These endpoints leak internal information. At minimum:

- Listen on a separate port, not the public one.
- Bind to localhost or a management VLAN.
- Require an auth token (header, mTLS).
- Rate-limit. A burst of `/debug/trace?seconds=60` requests can DoS your server.

### Cost per endpoint

| Endpoint | Cost | Stop-the-world? |
|---|---|---|
| `/debug/pprof/heap` | One GC cycle's worth | Yes, briefly |
| `/debug/pprof/profile?seconds=30` | ~0.1% CPU during capture | No |
| `/debug/pprof/goroutine?debug=2` | O(N goroutines) | Yes |
| `/debug/stacks` (full) | O(N goroutines) | Yes |
| `/debug/trace?seconds=10` | 5–20% CPU during capture | No (but heavy) |
| `/debug/gc` (force GC) | One GC cycle | Yes |

### Allowed mutations

Some debug endpoints intentionally mutate state:

- `/debug/gc` forces a GC. Useful for testing.
- `/debug/loglevel` (your own) toggles verbose logging.
- `/debug/profile?mutex_rate=5` could set `SetMutexProfileFraction` for the next investigation.

Treat them like admin APIs. They are.

---

## SetCgoTraceback for Cgo Crashes

When a Go program calls into C and crashes, the default Go traceback shows `cgocall` and nothing else. C frames are invisible. `runtime.SetCgoTraceback` plugs in a callback that walks the C stack using your toolchain's unwinder.

```go
import "runtime"
import _ "unsafe"

//go:cgo_import_static cgoTraceback
//go:cgo_import_static cgoContext
//go:cgo_import_static cgoSymbolizer

func init() {
    runtime.SetCgoTraceback(0,
        unsafe.Pointer(&cgoTraceback),
        unsafe.Pointer(&cgoContext),
        unsafe.Pointer(&cgoSymbolizer))
}
```

The callbacks are C functions (provided by libraries like `libgcc` or `libunwind`). Most application code never needs this; the relevant audience is system-level Go programs that embed substantial C and need to symbolize crashes in C frames.

Setup is platform-specific. Refer to `golang.org/x/exp/cgosymbolizer` for a turnkey implementation.

---

## Capacity-Planning Inputs from the Runtime

The runtime exposes the numbers you need to plan.

### CPU budget

- `/cpu/classes/user/total:cpu-seconds` — application CPU.
- `/cpu/classes/gc/total:cpu-seconds` — GC CPU. Should be < 25% of user.
- `/cpu/classes/scavenge/total:cpu-seconds` — scavenger CPU. Tiny normally.
- `/cpu/classes/idle/total:cpu-seconds` — idle.

Ratio `gc/(user+gc)` tells you GC overhead. If > 25%, raise `GOMEMLIMIT` or reduce allocations.

### Memory budget

- `/memory/classes/total:bytes` — total memory the runtime tracks.
- `/memory/classes/heap/objects:bytes` — live objects.
- `/memory/classes/heap/unused:bytes` — heap held but not in use.
- `/memory/classes/heap/released:bytes` — returned to OS (madvise).

Working set ≈ `total - released`. Plan capacity at `peak * 1.3` to leave room for GC overshoot.

### Goroutine budget

- `/sched/goroutines:goroutines` — current count.

If steady-state is X and p99 is Y, plan for Y * 1.5. Goroutines are cheap but not free at huge counts.

### Latency budget

- `/sched/latencies:seconds` histogram — runnable-to-running latency.

p99 > 1 ms = scheduler is overloaded relative to your latency goal. Either reduce concurrent work or raise `GOMAXPROCS`.

### GC budget

- `/gc/pauses:seconds` histogram — STW pause durations.
- `/gc/cycles/total:gc-cycles` — total cycles.

p99 STW pause is usually < 1 ms on modern Go. If higher, the heap is large or full of pointer-heavy structures.

---

## Self-Assessment

- [ ] I can wrap an HTTP server with `pprof.Do` middleware that labels by endpoint and tenant.
- [ ] I can explain how labels propagate to child goroutines and where they leak.
- [ ] I have set up a continuous profiling pipeline (or used one) and consumed its labels.
- [ ] I can capture and read a `runtime/trace` snapshot, identifying GC pauses and channel bottlenecks.
- [ ] I have wired `runtime/metrics` into Prometheus, including histograms.
- [ ] I can write an adaptive `GOMEMLIMIT` controller responding to cgroup signals.
- [ ] I have authenticated `/debug` endpoints exposing pprof, stacks, trace, and metrics.
- [ ] I know what `SetCgoTraceback` does and when to enable it.
- [ ] I can derive CPU, memory, goroutine, and latency capacity numbers from `runtime/metrics`.
- [ ] I can explain why `pprof.Do` is preferable to `SetGoroutineLabels`.

---

## Summary

Senior-level runtime management is about *systems built on top of* the runtime API. The APIs themselves do not change — `NumGoroutine`, `SetGoroutineLabels`, `metrics.Read`, `trace.Start` — but the way you wire them into production does. Continuous profiling, label-aware sampling, adaptive memory controllers, and authenticated diagnostic endpoints are senior-level concerns that turn the runtime's exposed knobs into operational power.

The professional file (next) opens the hood: where each API hooks into runtime internals, the cost models of each call, and how the scheduler and GC consume the values you set.
