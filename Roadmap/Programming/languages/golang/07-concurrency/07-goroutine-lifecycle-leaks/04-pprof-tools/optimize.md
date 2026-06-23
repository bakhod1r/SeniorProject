# pprof and Profiling Tools — Optimize

## Table of Contents
1. [How to Use This File](#how-to-use-this-file)
2. [Optimisation Mindset with pprof](#optimisation-mindset-with-pprof)
3. [Optimisation 1: Reduce Goroutine Profile Overhead](#optimisation-1-reduce-goroutine-profile-overhead)
4. [Optimisation 2: Right-Size Mutex Profile Fraction](#optimisation-2-right-size-mutex-profile-fraction)
5. [Optimisation 3: Tune `MemProfileRate`](#optimisation-3-tune-memprofilerate)
6. [Optimisation 4: Shorter CPU Profile Windows](#optimisation-4-shorter-cpu-profile-windows)
7. [Optimisation 5: Move Labels Out of the Hot Path](#optimisation-5-move-labels-out-of-the-hot-path)
8. [Optimisation 6: PGO Adoption](#optimisation-6-pgo-adoption)
9. [Optimisation 7: Replace Hand-Rolled Snapshotting with a Continuous Profiler](#optimisation-7-replace-hand-rolled-snapshotting-with-a-continuous-profiler)
10. [Optimisation 8: Cut Profile Storage Cost](#optimisation-8-cut-profile-storage-cost)
11. [Optimisation 9: Pre-Compile Profile Endpoints into a Single Mux](#optimisation-9-pre-compile-profile-endpoints-into-a-single-mux)
12. [Optimisation 10: Use Trace for Latency Work Instead of CPU Profiles](#optimisation-10-use-trace-for-latency-work-instead-of-cpu-profiles)
13. [Self-Assessment](#self-assessment)
14. [Summary](#summary)

---

## How to Use This File

Each section identifies a recurring inefficiency in how teams use pprof and shows the better approach. The goal is not to make pprof itself faster — it is to use less of your service's CPU and operator time getting the same answer.

---

## Optimisation Mindset with pprof

Two truths frame everything that follows:

1. **A profile is information about a workload, not the workload itself.** Optimising pprof rarely makes your service faster on its own. Optimising what pprof reveals does.
2. **The cheapest profile is the one you do not take.** Most teams over-sample. Reducing collection frequency and fraction is often the largest CPU saving from "optimising pprof."

The biggest wins are organisational: collecting fewer, better-targeted profiles; switching to continuous profiling so individual collections become unnecessary; tuning sampling fractions to the order of magnitude of the workload.

---

## Optimisation 1: Reduce Goroutine Profile Overhead

### Problem

A monitoring system curls `/debug/pprof/goroutine` every 10 seconds. On a service with 200k goroutines, each call costs ~5 ms of stop-the-world. That is 0.05% wall time wasted on diagnostics.

### Fix

Three layers:

1. **For raw count, use `runtime.NumGoroutine()` exported via Prometheus.** No stop-the-world.

   ```go
   prometheus.NewGaugeFunc(
       prometheus.GaugeOpts{Name: "go_goroutines"},
       func() float64 { return float64(runtime.NumGoroutine()) },
   )
   ```

2. **For periodic snapshots, drop to once a minute.** A leak grows over minutes, not seconds.
3. **For the spike that actually matters, wait for a trigger.** Hook a snapshot to an alert: "fire only if `go_goroutines > X for 5m`."

### Saving

Typical: 0.04% CPU back, plus less log noise. Not enormous, but free.

---

## Optimisation 2: Right-Size Mutex Profile Fraction

### Problem

```go
runtime.SetMutexProfileFraction(1)
```

Every contention is sampled. On a busy service with many contended mutexes, this can add 1–2% CPU.

### Fix

Start at 100. Move to 10 only when investigating. Move to 1 only briefly:

```go
runtime.SetMutexProfileFraction(100)
```

The samples still tell you which mutex is contended. 1 in 100 is more than enough for top-N stack analysis.

### Saving

Up to 1–2% CPU on lock-heavy workloads, near zero on lock-light ones.

---

## Optimisation 3: Tune `MemProfileRate`

### Problem

Default `runtime.MemProfileRate = 512 << 10` (512 KB). On an allocation-heavy service this is fine. On one allocating slowly, samples are sparse and the heap profile is noisy.

### Fix

For low-allocation services, lower the rate:

```go
runtime.MemProfileRate = 64 << 10 // 64 KB — denser samples
```

For services where heap profile overhead is measurable, raise it:

```go
runtime.MemProfileRate = 4 << 20 // 4 MB — sparser samples
```

Set this once, at init, before allocations begin. Changing it mid-run leaves a mixed-rate profile.

### Saving

Either fewer samples (less overhead) or denser samples (better signal). Tune to your service.

---

## Optimisation 4: Shorter CPU Profile Windows

### Problem

Operators routinely run `?seconds=120` or even `?seconds=300`. Profiles are huge, take long to fetch, and add ~5% CPU during the window.

### Fix

For most questions, 15–30 seconds is enough. 100 Hz × 30 s = 3000 samples — plenty for top-N analysis. Reserve 60-second profiles for rare cases.

For continuous profilers, 10-second windows every minute are standard.

### Saving

Linear with the profile duration. A 30-second profile costs 75% less CPU than a 120-second one.

---

## Optimisation 5: Move Labels Out of the Hot Path

### Problem

```go
for _, item := range items {
    pprof.Do(ctx, pprof.Labels("item", item.ID), func(ctx context.Context) {
        process(item)
    })
}
```

Per-iteration `pprof.Do` and per-iteration label allocation. Even when no profile is running, the overhead is real because `Do` modifies goroutine state.

### Fix

Move the label up:

```go
pprof.Do(ctx, pprof.Labels("phase", "batch"), func(ctx context.Context) {
    for _, item := range items {
        process(item)
    }
})
```

If per-item labels are essential for tracing, use `runtime/trace` regions (cheaper when trace is off, richer when on) instead of pprof labels.

### Saving

Loop body becomes faster. Profile becomes more useful (one label per batch, not per item).

---

## Optimisation 6: PGO Adoption

### Problem

No profile-guided optimisation. The compiler does not know which paths are hot.

### Fix

```bash
curl -o default.pgo http://prod:6060/debug/pprof/profile?seconds=60
go build -pgo=default.pgo .
```

Commit `default.pgo` to the repo. Refresh quarterly or whenever the workload changes substantially.

### Saving

Typical 2–7% CPU. On a service spending $10k/month on CPU, that pays for the engineering time many times over.

---

## Optimisation 7: Replace Hand-Rolled Snapshotting with a Continuous Profiler

### Problem

A `time.Ticker` loop uploading profiles to S3 every minute. Disk space adds up. Querying historical data means downloading and running `go tool pprof` per file.

### Fix

Adopt Pyroscope, Parca, Polar Signals Cloud, Google Cloud Profiler, or Datadog. The agent does the upload. The backend stores and indexes. The UI queries across time.

```go
import "github.com/grafana/pyroscope-go"

pyroscope.Start(pyroscope.Config{
    ApplicationName: "my-service",
    ServerAddress:   "https://pyroscope.example.com",
})
```

### Saving

Engineering time on incident response. The old way: "find the profile from yesterday at 2pm, download it, run `go tool pprof`, look at the diff vs today." The new way: "open Grafana, click yesterday at 2pm." Minutes vs seconds.

---

## Optimisation 8: Cut Profile Storage Cost

### Problem

Hand-rolled snapshots produce 5 KB per pod per minute. 500 pods × 1440 minutes × 5 KB = 3.6 GB per day. S3 costs add up.

### Fix

- **Gzip before upload.** Profiles compress to ~30% of their raw size.
- **Tiered retention.** Keep 1-minute resolution for 24 hours, 1-hour resolution for 7 days, 1-day resolution for 30 days.
- **Drop redundant types.** If you have heap, you may not need allocs for routine storage — keep heap, only collect allocs on demand.
- **Use a continuous profiler** that does this internally.

### Saving

Storage cost down 70–90%. Retention quality often goes up because the surviving data is curated.

---

## Optimisation 9: Pre-Compile Profile Endpoints into a Single Mux

### Problem

Every service registers pprof handlers slightly differently:

```go
// service A
mux.HandleFunc("/debug/pprof/", pprof.Index)
mux.HandleFunc("/debug/pprof/profile", pprof.Profile)
// service B
mux.HandleFunc("/debug/", pprof.Index)
// service C
// uses http.DefaultServeMux
```

Operators have to remember the right URL for each service.

### Fix

A shared internal library:

```go
// internal/admin/pprof.go
package admin

import (
    "net/http"
    "net/http/pprof"
)

func Register(mux *http.ServeMux) {
    mux.HandleFunc("/debug/pprof/", pprof.Index)
    mux.HandleFunc("/debug/pprof/cmdline", pprof.Cmdline)
    mux.HandleFunc("/debug/pprof/profile", pprof.Profile)
    mux.HandleFunc("/debug/pprof/symbol", pprof.Symbol)
    mux.HandleFunc("/debug/pprof/trace", pprof.Trace)
    mux.Handle("/debug/pprof/goroutine", pprof.Handler("goroutine"))
    mux.Handle("/debug/pprof/heap", pprof.Handler("heap"))
    mux.Handle("/debug/pprof/allocs", pprof.Handler("allocs"))
    mux.Handle("/debug/pprof/block", pprof.Handler("block"))
    mux.Handle("/debug/pprof/mutex", pprof.Handler("mutex"))
    mux.Handle("/debug/pprof/threadcreate", pprof.Handler("threadcreate"))
}
```

Every service calls `admin.Register(adminMux)`. URLs are uniform. Auth and rate-limit wrappers go in the same library.

### Saving

Operator time and reduced surface for misconfiguration.

---

## Optimisation 10: Use Trace for Latency Work Instead of CPU Profiles

### Problem

The team reaches for `?seconds=30` CPU profiles to diagnose p99 latency spikes. The profile shows the hottest functions but those functions are *not* the latency culprit — the culprit is GC pauses, scheduler delays, or upstream waits.

### Fix

Use `runtime/trace` for latency:

```bash
curl -o trace.out http://host:6060/debug/pprof/trace?seconds=5
go tool trace trace.out
```

Look at:

- **Scheduler latency profile** — time goroutines spent runnable but not running.
- **Synchronization blocking profile** — what they waited on.
- **GC events on the timeline** — pause durations.

This is the same data a CPU profile can never give you.

### Saving

Faster root-cause identification. A 30-minute hunt with CPU profiles becomes a 5-minute hunt with trace.

---

## Self-Assessment

- [ ] My services export goroutine count as a Prometheus metric, not via a regular profile fetch.
- [ ] Mutex profile fraction is 100 or higher in production.
- [ ] CPU profiles are 30 seconds, not 5 minutes.
- [ ] I do not use unbounded-cardinality labels.
- [ ] I have applied PGO at least once and measured the result.
- [ ] I have a continuous profiler running, or a documented plan to adopt one.
- [ ] My profile storage has tiered retention or is delegated to a continuous profiler.
- [ ] Pprof routes live in a shared library, not copy-pasted.
- [ ] For latency work, I reach for `runtime/trace` first.

---

## Summary

Optimising pprof use is mostly subtractive. Most teams over-sample, store too much, and use the wrong tool for the question. The improvements that matter: stop using full goroutine profiles for cheap counts, tune the sampling fractions to the workload, keep CPU profile windows short, use labels with bounded cardinality, adopt PGO, move to a continuous profiler instead of hand-rolled snapshot loops, and switch to `runtime/trace` for latency questions where CPU profiles are silent. Each of these gives back a percent or two of CPU, hours of operator time, or — most importantly — turns vague investigations into precise ones.
