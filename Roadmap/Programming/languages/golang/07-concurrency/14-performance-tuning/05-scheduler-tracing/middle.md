# Scheduler Tracing — Middle Level

[Back to index](index.md)

## Table of Contents
1. [Introduction](#introduction)
2. [`go tool trace` Architecture](#go-tool-trace-architecture)
3. [The Trace UI Tour](#the-trace-ui-tour)
4. [View Trace: Anatomy of a Timeline](#view-trace-anatomy-of-a-timeline)
5. [Per-Goroutine Lanes](#per-goroutine-lanes)
6. [Reading State Transitions](#reading-state-transitions)
7. [Goroutine Analysis View](#goroutine-analysis-view)
8. [Scheduler Latency Profile in Depth](#scheduler-latency-profile-in-depth)
9. [Network, Sync, and Syscall Blocking Profiles](#network-sync-and-syscall-blocking-profiles)
10. [Minimum Mutator Utilisation](#minimum-mutator-utilisation)
11. [GC Interactions in the Timeline](#gc-interactions-in-the-timeline)
12. [Procs, Heap, Threads, and Goroutines Counters](#procs-heap-threads-and-goroutines-counters)
13. [`runtime/metrics` Practical Wiring](#runtimemetrics-practical-wiring)
14. [Combining Trace with pprof](#combining-trace-with-pprof)
15. [Diagnostics Playbook](#diagnostics-playbook)
16. [Common Anti-Patterns](#common-anti-patterns)
17. [Self-Assessment](#self-assessment)
18. [Summary](#summary)

---

## Introduction

At junior level you learned that `runtime/trace` produces a binary file and `go tool trace` opens it in a browser. You opened the five built-in views and recognised what a healthy timeline looks like. Middle level is fluency. You will navigate the UI without thinking about which menu item to pick. You will know which view answers which question. You will read scheduler-latency histograms by percentile. You will pair traces with pprof for "what was that goroutine doing while it was running" answers. You will recognise GC interactions, syscall donations, and netpoller integration on sight.

This file is the trace counterpart of `04-pprof-tools/middle.md`. Same shape: tour, depth on the most useful views, practical workflow, anti-patterns.

---

## `go tool trace` Architecture

It helps to know what is happening when you run the tool.

```bash
go tool trace trace.out
```

1. The tool reads the binary trace from disk.
2. It parses the event stream (millions of events for a busy 5-second trace) into Go data structures.
3. It splits the trace into "chunks" of ~1 million events each — the JS UI cannot render more than that at once.
4. It starts an HTTP server on `localhost` on a random port.
5. It opens the system browser at that URL.
6. Each subsequent request to the server triggers on-demand re-analysis: per-goroutine summaries, profile aggregations, etc.

The tool stays running until you Ctrl-C it. The browser tab will not work after you stop it (links go nowhere).

Tip: for huge traces (>200 MB), use `-pprof=...` flags to extract specific profiles to files without launching the UI:

```bash
go tool trace -pprof=sched trace.out > sched.prof
go tool trace -pprof=net trace.out > net.prof
go tool trace -pprof=sync trace.out > sync.prof
go tool trace -pprof=syscall trace.out > syscall.prof
```

These are pprof-format profiles you can then open with `go tool pprof`. Combining is often easier than browsing the timeline.

---

## The Trace UI Tour

When you open the trace, the index page lists, top to bottom:

1. **View trace by proc** — timeline grouped by P.
2. **View trace by thread** — timeline grouped by M.
3. **Goroutine analysis** — per-function aggregates.
4. **Network blocking profile** — `/io` blocking time.
5. **Synchronization blocking profile** — channel and mutex waits.
6. **Syscall blocking profile** — time in syscalls.
7. **Scheduler latency profile** — runnable-but-not-running time.
8. **User-defined tasks** — populated by `trace.NewTask`.
9. **User-defined regions** — populated by `trace.WithRegion`.
10. **Minimum mutator utilisation** — GC overhead view.

Each section is a separate analysis. Memorise which is which; you will pick from this menu daily.

---

## View Trace: Anatomy of a Timeline

Click **View trace by proc**. The page that opens is a customised Chromium trace viewer.

Controls:

- `w`, `s` — zoom in, zoom out.
- `a`, `d` — pan left, pan right.
- `f` — zoom to current selection.
- `m` — measure between two clicks.
- `1` — select tool.
- `2` — pan tool.
- `3` — zoom tool.

The viewport defaults to the entire trace. Use `w` to zoom into a few-millisecond window. The viewer becomes useful only at the ~µs to ~ms scale; the full trace is too compressed.

Lanes from top to bottom:

```
PROCS                <-- per-P lanes, each showing the G running on that P.
  Proc 0
  Proc 1
  ...
  Proc 7
STATS                <-- summary counters over time.
  Goroutines
  Heap
  Threads
GC                   <-- GC mark/sweep events.
  GC
SC                   <-- system calls.
  Syscall
NETPOLL              <-- network poller wakeups.
USER                 <-- your custom regions, if any.
```

The PROCS lanes are the densest source of information. Each P lane shows a series of horizontal coloured bars; each bar is one goroutine executing for some interval. The colour is assigned by goroutine ID; the label is the function name at the time the G started running.

---

## Per-Goroutine Lanes

Switch to **View trace by thread** to get per-M (OS thread) lanes instead of per-P. Useful when you suspect a thread is doing something weird (cgo, signal handling, syscall storm).

The per-G view does not exist directly, but if you click on a goroutine event and select **Goroutines (G IDs)**, the viewer can pivot. In practice it is more efficient to:

1. Note the G id from the View trace bar you care about.
2. Go back to the index and click **Goroutine analysis**.
3. Find that G id and click through to its lifetime.

---

## Reading State Transitions

When you click a bar in the timeline, the bottom panel shows:

```
G 142
Function: net/http.(*conn).serve
Duration: 142.5µs
Start: 1.234567890s
End: 1.234710390s
```

And the **Selected events** table lists state transitions:

```
1.234500000s GoStart  -> running on Proc 3
1.234600000s GoBlock  -> waiting on chan receive
1.234670000s GoUnblock -> runnable
1.234700000s GoStart  -> running on Proc 5
1.234710390s GoEnd
```

This is the lifecycle of a single G: runnable, running, blocked, runnable again, running again, done. Each transition has a timestamp; subtracting consecutive timestamps gives you wait times.

The event types you will see most:

- `GoCreate` — go statement created this G.
- `GoStart` — M picked up G; runnable → running.
- `GoBlock*` — running → waiting, with reason: `Recv`, `Send`, `Select`, `Sync`, `SyncCond`, `Net`, `IO`, `GC`.
- `GoSysCall` — entered syscall.
- `GoSysBlock` — syscall took longer than 20µs; P was donated.
- `GoSysExit` — left syscall.
- `GoUnblock` — waiting → runnable (note: not yet running).
- `GoEnd` — G returned from its top function.
- `GoSched` — voluntary `runtime.Gosched()`.
- `GoPreempt` — preempted by async preemption or `morestack` check.

Read the timeline as: a G's "runnable but not running" intervals are scheduler latency. A G's "waiting" intervals are blocking; the reason tells you what to fix.

---

## Goroutine Analysis View

Click **Goroutine analysis**. A table appears listing every distinct goroutine function in the trace, with columns:

```
Function                       N     Total      Avg      Execution  Network  Sync   Scheduling  GC
runtime.gcBgMarkWorker         8     120ms     15ms      80ms       0        20ms   18ms        2ms
main.handleRequest             1200  3.2s      2.7ms     1.1s       1.6s     400ms  80ms        20ms
main.worker                    16    4.5s      280ms     4.4s       0        80ms   15ms        5ms
```

What the columns mean:

- **N** — number of goroutines with this start function.
- **Total** — wall time across all of them.
- **Execution** — time spent in `_Grunning`.
- **Network** — blocked on netpoll.
- **Sync** — blocked on channels, mutexes, condition variables.
- **Scheduling** — runnable but not running.
- **GC** — assist or sweep time.

The pivot is: for the function dominating wall time, where is that time going? If Execution dominates, CPU profile the function. If Network dominates, look upstream. If Sync dominates, enable a block profile. If Scheduling dominates, you have queueing.

Click on a function to drill down to a per-goroutine breakdown.

---

## Scheduler Latency Profile in Depth

The single most-used view for tail latency.

Click **Scheduler latency profile**. A `pprof`-style call graph appears showing **time spent runnable but not yet running**, attributed to the function that became runnable. Read it with the same flame-graph reflexes you have from CPU profiles.

```
(pprof) top
Showing nodes accounting for 1.4s, 100% of 1.4s total
      flat  flat%   sum%        cum   cum%
     0.9s 64.29% 64.29%      0.9s 64.29%  main.handleRequest
     0.3s 21.43% 85.71%      0.3s 21.43%  main.flush
     0.2s 14.29%   100%      0.2s 14.29%  runtime.gcBgMarkWorker
```

Interpretation: across the trace window, 0.9 seconds of cumulative "runnable but waiting" time accumulated for `main.handleRequest`. Either there are not enough Ps, or the work is being pushed to the global runqueue under contention, or another G is hogging CPU.

The view is built from the gap between `GoUnblock` (or `GoCreate`) and the subsequent `GoStart` for each G.

Tip: extract this view as a standalone pprof profile and analyse offline:

```bash
go tool trace -pprof=sched trace.out > sched.prof
go tool pprof -http=:8080 sched.prof
```

You get all of pprof's filters (`focus`, `ignore`, `tagfocus`) on scheduler latency.

---

## Network, Sync, and Syscall Blocking Profiles

Three blocking profiles, each a pprof-format aggregate of one event class.

### Network blocking profile

Sum of times Gs spent blocked on netpoll. Pre-aggregated per call site.

```
(pprof) top
     2.1s 70%  net.(*conn).Read
     0.9s 30%  net/http.(*conn).readRequest
```

Use it for "where is my service waiting on the network." Contrast with a CPU profile: a Network bar that takes 2s of wall time uses ~zero CPU.

### Synchronization blocking profile

Channels, `sync.Mutex.Lock`, `sync.WaitGroup.Wait`, `sync.Cond.Wait`. Pre-aggregated. The classic block profile from `runtime.SetBlockProfileRate` gives you the same data — but the trace version is **complete** (every event, not sampled).

### Syscall blocking profile

Time goroutines spent in syscalls. Includes IO that was not netpoll-managed (file reads, name resolution) and cgo blocking calls.

The combination of these three covers all the ways a G can be off-CPU. If your latency view shows a G that was off-CPU for 100ms, summing across these three profiles will tell you which class of wait dominated.

---

## Minimum Mutator Utilisation

Click **Minimum mutator utilisation**. A graph appears: x-axis = time window length, y-axis = minimum fraction of CPU available to user code in any such window.

- At window=0, the curve dips to 0 if any STW pause exists at all.
- At window=1ms, the curve sits at maybe 0.85 — meaning at the worst 1ms window, 15% of CPU was unavailable.
- At window=1s, the curve climbs to 0.95 — averaged out, GC takes 5%.

The curve **never decreases** as window grows; that is the definition of "minimum over windows of size W."

How to use it: find the knee. If at 5ms window the curve is at 0.30, then in some 5ms windows of your trace, GC ate 70% of CPU. That is a latency disaster waiting to happen.

This is the view to show your team when arguing for GC tuning (`GOGC`, `GOMEMLIMIT`) or for reducing allocation churn.

---

## GC Interactions in the Timeline

GC has its own lane in **View trace**. Click on a GC event and you will see:

```
GC start at 1.234567s
Duration: 12.4ms
Goroutine: gcBgMarkWorker (G 12)
```

GC events overlay user lanes. While a mark phase is active, several user Gs will show "GC assist" segments in red — that is the runtime stealing user time to help with marking.

Pattern to recognise:

- Long red stripes across many P lanes = many mark assists. The application is allocating faster than the background mark workers can keep up; the runtime forces user Gs to assist.
- A short orange vertical bar across all lanes = STW pause (sweep termination or mark termination).
- Continuous green/blue lane in the GC row = background mark workers running concurrently.

If your latency spikes correlate with red stripes, you have a "mutator allocates too fast" problem. Reduce allocation rate or raise `GOGC`.

---

## Procs, Heap, Threads, and Goroutines Counters

Under the **STATS** group, four counters scroll along with the timeline:

- **Goroutines** — live goroutine count. Spikes correlate with bursts of work.
- **Heap** — current allocated heap. Saw-tooth: grows, GC, drops, grows. Steepness of the rising edge = allocation rate.
- **Threads** — OS thread count. Should be near `GOMAXPROCS`; growth signals syscall storms.
- **Procs running** — number of Ps actually running a G at each instant. Idle if this drops below `GOMAXPROCS`.

These counters are reproducible: at any zoom level, the line height at time T equals the live count at T.

A common diagnosis: scroll until you see a latency spike. Check the four counters at that moment. If goroutines spiked, you have a burst; if heap was full and dropped, GC just ran; if threads spiked, a syscall donated and another M was created.

---

## `runtime/metrics` Practical Wiring

Trace files are for one-shot deep dives. For continuous observability, export the scheduler counters via `runtime/metrics`.

```go
package telemetry

import (
    "runtime/metrics"
    "strings"

    "github.com/prometheus/client_golang/prometheus"
)

var schedLatency = prometheus.NewHistogram(prometheus.HistogramOpts{
    Name:    "go_sched_latency_seconds",
    Help:    "Time goroutines spent runnable before running.",
    Buckets: prometheus.ExponentialBuckets(1e-6, 2, 24),
})

var goroutines = prometheus.NewGauge(prometheus.GaugeOpts{
    Name: "go_goroutines_total",
    Help: "Live goroutine count.",
})

func init() {
    prometheus.MustRegister(schedLatency, goroutines)
}

// SnapshotEvery installs a periodic exporter.
func SnapshotEvery(d time.Duration, stop <-chan struct{}) {
    samples := []metrics.Sample{
        {Name: "/sched/latencies:seconds"},
        {Name: "/sched/goroutines:goroutines"},
    }
    t := time.NewTicker(d)
    defer t.Stop()
    for {
        select {
        case <-stop:
            return
        case <-t.C:
            metrics.Read(samples)
            populate(samples)
        }
    }
}

func populate(samples []metrics.Sample) {
    for _, s := range samples {
        if strings.HasSuffix(s.Name, ":goroutines") {
            goroutines.Set(float64(s.Value.Uint64()))
            continue
        }
        if s.Value.Kind() == metrics.KindFloat64Histogram {
            for _, b := range s.Value.Float64Histogram().Buckets {
                _ = b // build a Prometheus histogram from the bucket boundaries.
            }
        }
    }
}
```

The skeleton above sketches the integration; the production version maps `runtime/metrics` histograms to Prometheus's `Histogram` type with care (Prometheus histograms have fixed bucket boundaries, the runtime histogram is variable-width). Libraries like `github.com/prometheus/client_golang/prometheus/collectors` ship a `NewGoCollector(collectors.WithGoCollections(collectors.GoRuntimeMetricsCollection))` that does this for you.

The point: export both the live count and the scheduler-latency histogram. The first warns you about leaks, the second alarms on tail latency.

---

## Combining Trace with pprof

Tracing and profiling overlap. Use them together:

1. **CPU profile to find the hot function.** "decode is 40% of CPU."
2. **Trace to find when it ran.** "decode runs during request handling, takes 200µs each time, 4ms in the tail."
3. **Scheduler-latency view to find queueing.** "tail latency is 95% scheduler queue, not decode."

Captured side by side:

```bash
curl -o cpu.prof http://127.0.0.1:6060/debug/pprof/profile?seconds=5 &
curl -o trace.out http://127.0.0.1:6060/debug/pprof/trace?seconds=5 &
wait
```

The two captures cover the same window. Open each in its own tool; cross-reference timestamps.

Cost: with both running, overhead is roughly 10–25%. Acceptable for a one-off, not for hours.

---

## Diagnostics Playbook

| Question | View |
|----------|------|
| Why is p99 high? | Scheduler latency profile + network blocking. |
| Why is service idle when CPU should be saturated? | View trace: gaps on P lanes. |
| Is GC eating my latency? | Minimum mutator utilisation. |
| Where do goroutines block most? | Synchronization blocking profile. |
| How long does my function actually wait? | Goroutine analysis. |
| What was happening at 14:23:42? | View trace: zoom to timestamp. |

### Walk-through: tail-latency hunt

1. Capture a 5-second trace during the symptom: `curl -o trace.out host:6060/debug/pprof/trace?seconds=5`.
2. `go tool trace trace.out`.
3. Open **Goroutine analysis**. Sort by total Scheduling time. Pick the function with the worst.
4. Click through to per-G detail. Note the G ids with the worst per-G scheduling time.
5. Open **View trace**. Search for one of those G ids.
6. Examine the timeline: is the G blocked on `chan recv`? Or runnable for ages? Or competing with another long-running G on the same P?
7. If scheduler-latency dominates, look at the **Procs running** counter at the same moment. If <GOMAXPROCS, the work was not even queued evenly.
8. Decide a fix: more workers, smaller batches, hand off to a goroutine pool, raise GOMAXPROCS.

### Walk-through: thread explosion

1. From `runtime/metrics`, gauge `/sched/total-threads` (or watch process FD count if you do not export it).
2. When it rises, capture a 2-second trace.
3. **View trace by thread**. Count the lanes.
4. Look at the **Syscall blocking profile** — the call sites with the longest blocking time are creating donations and forcing the runtime to spawn new Ms.
5. Audit those call sites: are they file IO without buffering? cgo? DNS without caching?

---

## Common Anti-Patterns

### Anti-pattern: tracing in production for hours

Production tracing is for sampling, not always-on. A 5-second trace captured during a real reproduction beats a 5-hour trace.

### Anti-pattern: trace UI for find-by-text

The viewer's search is slow on large traces. To find "function X", use `go tool trace -pprof=...` to extract to a pprof and search there.

### Anti-pattern: ignoring per-P balance

Reading only `gomaxprocs` and `runqueue` from schedtrace hides hot-Ps. Always look at the `[ ... ]` per-P list.

### Anti-pattern: capturing trace with race detector enabled

`-race` builds are slower and produce different scheduling. Disable race detection when capturing latency traces.

### Anti-pattern: trusting one trace

Scheduler behaviour is statistical. Capture two or three traces during the same symptom; if they all show the same pattern, conclude.

### Anti-pattern: looking at the trace at default zoom

The full-trace zoom is useless. Always zoom to a millisecond-wide window. If you do not know which window, use the scheduler-latency profile first.

### Anti-pattern: forgetting `gctrace=1` for the same window

Trace tells you when GC ran, but `gctrace` tells you sizes and durations in human-readable form. Pair them.

---

## Self-Assessment

- [ ] I have used **View trace** and can identify a per-P lane, a `_Grunning` block, and an idle gap.
- [ ] I read state transitions in the event panel.
- [ ] I use the scheduler-latency profile as the first stop for tail-latency questions.
- [ ] I have extracted `-pprof=sched` and analysed it with `go tool pprof`.
- [ ] I recognise mark-assist red stripes in the timeline.
- [ ] I export `/sched/goroutines:goroutines` and `/sched/latencies:seconds` to my metrics backend.
- [ ] I capture CPU profile and trace in the same window when scheduling is suspected.
- [ ] I avoid binding pprof to public addresses.

---

## Summary

`go tool trace` is the highest-bandwidth diagnostic tool Go ships. The five main views — timeline, goroutine analysis, the three blocking profiles, scheduler latency, MMU — cover scheduler, GC, syscalls, and netpoll. Master the scheduler-latency profile first; it answers most tail-latency questions. Read transitions in the per-G event panel for state-level questions. Pair with `runtime/metrics` for continuous observability. Use trace and pprof together when you need both "what was running" and "when did it queue." Keep traces short; ten seconds is the limit. The senior file adds user regions, tasks, and custom log events on top of this base.
